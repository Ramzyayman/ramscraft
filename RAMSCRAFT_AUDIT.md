# RamsCraft — Independent Security, QA & Reliability Audit

**Auditor:** Claude (independent review — no prior project context, all claims verified against source and a live instance)
**Date:** 2026-09-13
**Target:** RamsCraft Minecraft control panel — source at `~/ramscraft` on `ramzy@192.168.1.6`, backend live on `http://192.168.1.6:3001`
**Method:** full source read (backend + frontend + shared), live API/WebSocket testing, a real Paper 1.20.4 lifecycle on a throwaway server (port 25600), and controlled security probes. All test servers/sessions/files created during the audit were removed; the VM was left with one healthy backend and only the original `test` server.

---

## 1. Overall assessment

RamsCraft is an **early-stage prototype** that demonstrably works for the happy path — it downloads a real Paper jar, gates on the EULA, starts a server in a detached `tmux` session, streams the console, edits `server.properties`, queries players, stops gracefully, and (impressively) survives a backend restart and reconciles the running server back to ONLINE. The provider integrations against the live Paper v3 and Mojang APIs are real and current.

However, it is **not safe to run in its current state**, and several core reliability claims do not hold up:

- **It has no authentication and is trivially exploitable for remote code execution.** I confirmed an unauthenticated HTTP request executing an arbitrary shell command as the `ramzy` user (who was also just granted passwordless `sudo`). On a host with the firewall off, this is full host takeover from anywhere on the LAN.
- **Crash detection does not work.** I killed a running server's Java process; RamsCraft continued to report ONLINE indefinitely.
- **"Online" is decided by a TCP port ping**, which another service on the same port answers — so status can be wrong in both directions. The default port 25565 is already taken by a different (Crafty) container on this host.
- **Live CPU/RAM metrics never display for a running server** due to a status-string mismatch between front and back end.

The verdict: **good bones, working happy path, but do not expose it and do not trust its status display or its destructive operations yet.** The critical items below block real use.

---

## 2. What actually works (verified)

| Area | Result | Evidence |
|---|---|---|
| Provider list / Paper versions | ✅ 66 versions, 175 builds for 1.20.4 from live Paper v3 API | `GET /api/software/providers/paper/versions` |
| Vanilla versions | ✅ 852 versions incl. 1.8.9 from Mojang manifest | `GET .../vanilla/versions` |
| Server create + validation (basic) | ✅ Rejects empty name, port `80`, `maxRam<minRam`, dup name/port | `POST /api/servers` |
| Jar download | ✅ Real `paper-1.20.4-499.jar` fetched to server dir | install returned installerUrl, jar present |
| EULA gate | ✅ Start before EULA → `403 EULA_PENDING`; accept writes `eula=true`; then start works | lifecycle/start, /eula |
| Start lifecycle | ✅ STARTING → ONLINE (~30s), real `java` PID listening on the port | `pstree`, `ss -tlnp` showed java on :25600 |
| Java auto-selection | ✅ Picked Java 21 for 1.20.4 (min 17) | compat `{min:17,supported:[17,21]}` |
| Console history + live tail | ✅ `tmux pipe-pane` → log file → `tail -F`; "Done" banner captured | log tail |
| Send command | ✅ `say AUDIT_MARKER_123` appeared in server console | grep of log |
| Settings read/write | ✅ `max-players=30`, `difficulty=hard` written; **unknown keys preserved** | server.properties diff |
| Players query | ✅ `minecraft-server-util` returns online/max/sample | `GET .../players` → 0/20 |
| Graceful stop | ✅ ONLINE → OFFLINE, session gone, java dead | tmux/ps checks |
| **Backend-restart reconciliation** | ✅ Killed backend; MC (PID 7135) survived; on restart reconciled to ONLINE | reconciliation log + same PID alive |
| Basic path traversal | ✅ `../../etc/passwd`, URL-encoded, `../test` → `403 Access denied` | files/content probes |
| Zip-slip on upload-extract | ✅ Entry paths validated before extraction | code review of `/files/extract` |

---

## 3. Findings

Severity key: **CRITICAL** = exploitable/host-level or guaranteed data loss · **HIGH** = breaks a core feature or safety property · **MEDIUM** = wrong behaviour, recoverable · **LOW/INFO** = hygiene.

---

### CRITICAL

#### C-1 — Unauthenticated remote code execution via command injection
- **Severity:** CRITICAL — *blocks all real usage.*
- **What is wrong:** `ProcessService.sendCommand()` builds a shell command by string interpolation and runs it through `exec` (a shell): `` tmux send-keys -t <session> "<command>" C-m ``. Only double-quotes are escaped; `$( )`, backticks, `;`, `&&`, `|` are not. The `command`/`player` values come straight from the unauthenticated REST endpoint `POST /api/servers/:id/players/command` (and the `sendCommand` WebSocket event). There is **no authentication anywhere** in the app.
- **Why it matters:** The backend runs as `ramzy`, who is in the `docker` group **and now has passwordless `sudo`**. Anyone who can reach `:3001` (whole LAN; firewall is off) gets arbitrary command execution as root-capable `ramzy`.
- **Reproduction (performed, then cleaned up):**
  1. `POST /api/servers` → create throwaway server (got id).
  2. Started a `tmux` session named for that id so `hasSession()` returns true.
  3. `POST /api/servers/<id>/players/command` with body `{"command":"kick","player":"$(id > /tmp/rc_audit/injection_proof.txt)"}` → `200 {"success":true}`.
  4. `/tmp/rc_audit/injection_proof.txt` contained `uid=1000(ramzy) … groups=…,27(sudo),110(docker)`. **Injection confirmed.**
- **Expected:** Commands passed as argv (no shell), authenticated, and validated.
- **Affected:** `backend/src/services/ProcessService.ts` (`sendCommand`, `startServer`, `getConsoleHistory`), `backend/src/routes/players.routes.ts`, `backend/src/services/WebSocketService.ts`.
- **Fix:** Use `execFile`/`spawn` with argument arrays (never a shell string); if `tmux send-keys` must be used, pass the command as a single non-interpolated argv element and use `-l`/literal handling. Add authentication (see C-3). Validate player names against `^[A-Za-z0-9_]{1,16}$`.

#### C-2 — Backup *restore* can destroy the entire server directory
- **Severity:** CRITICAL — *potential total data loss.*
- **What is wrong:** `POST /api/servers/:id/backups/:file/restore` runs `` exec(`rm -rf "${serverDir}"/* && tar -xzf "${targetFile}" -C "${serverDir}"`) `` **in the background**, returns `200 "Restore started"` immediately, and never reports completion or failure. If the `tar` step fails (corrupt/partial archive, disk full, bad `:file`) after the `rm -rf` succeeds, the live server directory is already wiped with nothing restored. `:file` is also interpolated into the shell path with no sanitisation. Backups are created the same way (`tar` in background, success reported before the archive exists).
- **Why it matters:** The one operation whose entire purpose is data safety is the one most likely to lose data. There is no integrity check, no atomic swap, no offline verification of the archive, and the UI reports success regardless.
- **Reproduction:** Code path in `backend/src/routes/backups.routes.ts:52-75`; restore reported success with no way to know the outcome. (Not executed destructively against live data.)
- **Expected:** Restore into a temp dir, verify the archive lists cleanly, then atomically swap; never `rm -rf` before a verified extract; report real completion; sanitise `:file` to a basename.
- **Affected:** `backend/src/routes/backups.routes.ts`.
- **Fix:** As above; also run via `execFile('tar', [...])`, validate `:file` with `path.basename`, and stream progress over WebSocket.

#### C-3 — No authentication, `0.0.0.0` bind, `CORS: *`, firewall off
- **Severity:** CRITICAL (enabler for C-1/C-2).
- **What is wrong:** `index.ts` binds `0.0.0.0:3001` with `app.use(cors())` (default `*`), and the Socket.IO server sets `origin: '*'`. There is no login, token, or session anywhere. `ufw` on the host is inactive.
- **Why it matters:** Every endpoint — lifecycle control, file read/write/delete, command execution, backup/restore — is open to any device on the network with no credentials.
- **Expected:** Authentication on every route + WebSocket handshake; bind to localhost and reverse-proxy with auth, or require a token; restrict CORS to the known origin.
- **Affected:** `backend/src/index.ts`, `backend/src/services/WebSocketService.ts`.

---

### HIGH

#### H-1 — Crash of a running server is never detected (stuck ONLINE forever)
- **Severity:** HIGH.
- **What is wrong:** The only crash detector, `MetricsStreamer.checkStartingServers()`, only queries servers in `STARTING`. For `ONLINE` servers nothing checks liveness — `broadcastServerMetrics` swallows `pidusage` errors and moves on.
- **Reproduction (performed):** Started audit-lc → ONLINE (java PID 8168). `kill -9 8168`; tmux session gone. Polled status for 24 s: **stayed ONLINE** the whole time. It only leaves ONLINE on an explicit stop or a backend restart.
- **Why it matters:** Operators see a server as up when it has crashed; auto-recovery is impossible; players can't connect while the panel claims all is well.
- **Expected:** A periodic reconcile for ONLINE servers (session exists + process alive + optional ping) that transitions to CRASHED.
- **Affected:** `backend/src/services/MetricsStreamer.ts`, `ReconciliationService.ts`.

#### H-2 — "Online" is decided by a TCP port ping that other services answer
- **Severity:** HIGH.
- **What is wrong:** Both reconciliation and the STARTING→ONLINE transition call `pingServer(port)` on `127.0.0.1`. Anything listening on that port satisfies the check. The process-identity guard (`isJavaProcess`) accepts `java` **or `bash` or `node`**, so it is effectively always true (the tmux pane's pid is a shell).
- **Why it matters:** On this very host, port **25565** (the Minecraft default, and the port the existing `test` server is configured for) is already bound by the Crafty container's `docker-proxy`. I confirmed `connect 127.0.0.1:25565 → true`. A RamsCraft server on 25565 whose own process is dead will be reported ONLINE because Crafty answers the ping. Conversely two panels/servers fight over the port.
- **Expected:** Tie status to the actual process (verified pid belonging to *this* server's session) and, ideally, a Minecraft-protocol status handshake rather than a raw TCP connect; detect port conflicts at create/start.
- **Affected:** `ReconciliationService.ts`, `MetricsStreamer.ts`, `ProcessService.isJavaProcess`.

#### H-3 — Java compatibility enforces only a *minimum*; older servers auto-pick an incompatible JDK
- **Severity:** HIGH (silent start failures).
- **What is wrong:** `JavaVersionHelper.getStandardJavaRules` returns a `minVersion`; `LifecycleController` auto-selects the *lowest installed runtime ≥ min*. It never enforces the *maximum supported* JDK. Only Java 21 and 25 are installed on this host (no 8/11/16/17). So a 1.8–1.16 server (min 8) auto-selects Java 21, which cannot run those versions — the server will fail to boot with a cryptic JVM error, not a clear RamsCraft message.
- **Also:** `parseVersion` strips non-digits per dotted segment, so snapshot IDs like `24w14a` parse to `2414` and compare as "newer than 26.1" → demand Java 25. Vanilla exposes snapshots in the version list, so this is reachable from the UI.
- **Expected:** Respect `supportedVersions` (upper bound); if no compatible *and installed* runtime exists, refuse with a clear message; handle non-release version strings.
- **Affected:** `backend/src/providers/JavaVersionHelper.ts`, `backend/src/controllers/LifecycleController.ts`.

#### H-4 — Live CPU/RAM metrics never show for a running server (front/back contract mismatch)
- **Severity:** HIGH (advertised feature is dead).
- **What is wrong:** Two overlapping systems disagree on the status string:
  - `WebSocketService.startStatsBroadcaster` emits `serverStats` but only for `status in ['RUNNING','STARTING']`. **`RUNNING` is not a valid status** (the enum uses `ONLINE`).
  - `ServerOverview.tsx` subscribes to `serverStats` only while `server.status === 'RUNNING' || 'STARTING'` — again `RUNNING` never exists.
  - `MetricsStreamer` emits a *different* event `serverMetrics` for `ONLINE` servers, which **no frontend code listens to.**
  - Net effect: stats can only appear during the brief STARTING window; once ONLINE they stop. The Overview then shows placeholder/zero values.
- **Evidence:** Source cross-reference; the enum in `shared/src/index.ts` has no `RUNNING`.
- **Expected:** One metrics event, gated on `ONLINE`, consumed by the frontend.
- **Affected:** `WebSocketService.ts`, `MetricsStreamer.ts`, `frontend/.../ServerOverview.tsx`, `shared/src/index.ts`.

#### H-5 — Orphan handling can `SIGKILL` an unrelated process (PID reuse)
- **Severity:** HIGH.
- **What is wrong:** On startup, if a server has a stored `lastKnownPid` but no tmux session, reconciliation does `process.kill(lastKnownPid, 'SIGKILL')` when `isJavaProcess(pid)` is true. After a reboot/crash the PID is very likely reused by an unrelated process, and `isJavaProcess` matches `java`/`bash`/`node`, so an innocent shell/node process can be force-killed.
- **Expected:** Never trust a bare stored PID across restarts; verify the process command line belongs to *this* server before signalling.
- **Affected:** `ReconciliationService.ts:45-53`, `ProcessService.isJavaProcess`.

---

### MEDIUM

#### M-1 — "Generate New World" does not generate a world
`worlds.routes.ts` `/worlds/generate` only renames any existing folder aside, edits `level-name`, and returns `success` with a message that Minecraft will generate it "on next start." It never verifies generation (the route body even contains a long block of the developer's unresolved stream-of-consciousness comments left in shipped code). The UI implies an action completed. — *Fix:* actually generate (start headless, wait for "Done", stop) or rename the button to "Configure new world"; remove the comment block.

#### M-2 — Downloaded jars are never checksum-verified
Both providers fetch a `sha256`/`sha1` (`getDownloadInfo`) but `SoftwareController.prepareInstallation` streams the jar to disk and never compares it. No integrity/tamper protection, and a truncated download is used as-is. — *Fix:* verify the hash after download; fail closed.

#### M-3 — Deleting a server orphans its files and any running process
`DELETE /api/servers/:id` removes only the DB row. **Verified:** after delete, `servers/audit-lc/` (and its ~65 MB jar) remained on disk. It also doesn't stop a running server first, and there's no server-side offline/confirmation guard — you can delete a server whose Java process keeps running headless forever. — *Fix:* stop/verify offline, then remove the directory (and backups) in a transaction.

#### M-4 — Path check uses `startsWith(serverDir)` without a separator (sibling-prefix escape)
`files.routes.ts` guards with `fullPath.startsWith(serverDir)`. Because `serverDir` has no trailing separator, a sibling directory whose name shares the prefix (e.g. server dir `.../servers/test`, sibling `.../servers/test-`) passes the check, letting one server read/move/delete another's files. Symlinks inside the tree are also not resolved (`fs.realpath`), so a symlink can escape the root. — *Fix:* compare against `serverDir + path.sep` and resolve real paths.

#### M-5 — Instance settings update has no validation
`ServerController.updateServer` writes `name/port/minRamMb/maxRamMb/...` with no checks (create *does* validate). You can set `maxRam` beyond host memory, `min>max`, or an invalid/duplicate port via the API. No upper RAM bound vs the host's ~9.7 GB. — *Fix:* share the create validators; cap RAM to host.

#### M-6 — Console shows raw terminal escape codes; xterm is imported but unused
The console renders log lines as plain `<div>`s. Because output comes from `tmux pipe-pane`, control sequences (`[K`, `[?1l`, `[?2004h`, etc.) appear verbatim — visible in captured history. `xterm`/`xterm-addon-fit` are dependencies but not wired up. — *Fix:* strip ANSI/control sequences or render through xterm.

#### M-7 — Two redundant metrics/poll loops + a stats broadcaster querying a non-existent status
`WebSocketService` (3 s) and `MetricsStreamer` (2 s) both poll the DB and `pidusage` on intervals whenever any room is open, with overlapping responsibilities and the dead `RUNNING` filter (see H-4). Wasted work and confusing ownership. — *Fix:* consolidate into one streamer keyed on `ONLINE`.

#### M-8 — Frontend cannot be built on the VM; deploy is ad-hoc
`deploy.log` shows the frontend build failing on the VM: Vite/rolldown require Node ≥20, VM runs Node 18 (`SyntaxError: … 'node:util' … 'styleText'`). `pm2` is referenced in deploy scripts but not installed (`pm2: command not found`); the app actually runs via `start.sh` (`nohup node dist/index.js`). The served bundle is built on Windows and copied up, so the VM's `frontend/src` is **behind** the deployed `dist` and could not be rebuilt in place. Deploy scripts are `paramiko` one-offs. — *Fix:* pin Node 20+ on the VM (or build in CI), add a real process manager/systemd unit, commit a documented deploy path.

---

### LOW / INFO

- **L-1 Secrets in the repo:** the SSH password is hard-coded in `deploy*.py` (local repo) and was present in `deploy.py`/`deploy4.py` on the VM. Rotate it and move to key-only auth / env vars.
- **L-2 Dangerous dev artifacts shipped:** `backend/wipe.js` deletes **all** servers from the DB; `test.mjs`, `fix_strings.js`, `scripts/test_*` ship alongside the app. Remove from production.
- **L-3 No autostart:** RamsCraft is not a service and will not come back after a reboot (matches its "local testing" status, but worth a systemd unit before real use).
- **L-4 Broken link:** Settings' "Advanced Configuration" links to `/servers/:id/files` but the route is `/server/:id/files` (singular) → dead link.
- **L-5 Placeholder data in UI:** Dashboard tiles show hard-coded `12%` / `1.2GB` for ONLINE servers; ServerOverview shows `0 / 20` players and a static uptime. Misleading vs real data available from the API.
- **L-6 Directory-name collisions:** `name.toLowerCase().replace(/[^a-z0-9]/g,'-')` maps distinct names to the same directory (e.g. trailing spaces → the existing `test`/`test-`), surfacing as a 409 whose message blames "name or port."
- **L-7 No hardening:** no `helmet`, no rate limiting, no request size limits on uploads; player avatars fetched from `minotar.net` (external dependency/availability).
- **L-8 Store type mismatch:** `useServersStore` types `software: string` while the API returns a `software` object; components read `server.software?.provider`. Works at runtime, wrong types.

---

## 4. Security findings (summary)
- **RCE via command injection, unauthenticated (C-1)** — confirmed live.
- **No auth / open CORS / 0.0.0.0 / firewall off (C-3)** — whole API and WS open to the LAN.
- **Destructive restore with no verification (C-2)** — data-loss risk; `:file` unsanitised in a shell string.
- **PID-reuse SIGKILL (H-5)** — can kill unrelated processes.
- **Sibling-prefix / symlink path escape (M-4)**; secrets in repo (L-1); wipe.js shipped (L-2).
- No checksum verification (M-2). No HTTPS; runs as a docker-group + now sudo-capable user.

## 5. Reliability findings (summary)
- Crash never detected → stuck ONLINE (H-1, confirmed).
- Status from a shared-port ping → false ONLINE/OFFLINE (H-2, confirmed 25565 answered by Crafty).
- Backend-restart reconciliation **works** (verified) — the one strong reliability property.
- No autostart (L-3); delete orphans process/files (M-3).

## 6. Performance findings (summary)
- Two overlapping 2–3 s polling loops (M-7). Console re-sends up to 1000 lines of history on every subscribe and renders unbounded escape sequences (M-6). `addLocalFolder`→`toBuffer` for directory downloads builds the whole zip in memory (large worlds → high memory). No upload size limits (L-7).

## 7. UX findings (summary)
- Placeholder metrics/players (L-5) and dead live-metrics pipeline (H-4) mean the Overview rarely reflects reality.
- Raw terminal codes in the console (M-6). Broken "Advanced Configuration" link (L-4). "Generate New World" claims success without generating (M-1). Software/version dropdowns work against live APIs and the create wizard now disables submit until a version loads (good).

## 8. Architectural concerns
- **Status is derived, not owned.** Liveness is inferred from a port ping + an over-broad process check, split across two services with a status-string mismatch. A single source of truth (verified pid ↔ session ↔ optional MC handshake) would fix H-1, H-2, H-4, H-5 together.
- **Shell-string command construction** throughout (`exec` with interpolation) is the root of C-1/C-2 — move to argv-based `spawn`/`execFile`.
- **No auth layer** designed in at all.
- **Build/runtime drift**: frontend can't build on the VM; `dist` is ahead of `src`; deploy is manual scripts.

## 9. Missing tests
- No automated tests run in CI; `scripts/test_*` are manual. Nothing covers: command-injection/argument-safety, path-traversal (incl. sibling-prefix & symlink), crash→CRASHED transition, port-conflict detection, Java min/max selection with the *installed* set, backup/restore round-trip integrity, or the WebSocket event contract (`serverStats` vs `serverMetrics`, status enum).

## 10. Recommended priority order
1. **C-3 + C-1:** add authentication and eliminate shell-string command construction (argv everywhere). Bind to localhost behind an authenticated proxy. *(blocks everything)*
2. **C-2:** make backup/restore safe (verify-then-swap, sanitise filename, real completion reporting).
3. **H-1 + H-2:** single ownership of status from verified process identity; detect crashes; detect port conflicts.
4. **H-3:** enforce Java max/supported and installed-runtime availability with clear errors.
5. **H-4:** fix the metrics event/status mismatch so live CPU/RAM works.
6. **H-5, M-3, M-4:** safe orphan handling; delete cleans files/process; tighten path checks (+ symlinks).
7. **M-1, M-2, M-5, M-6, M-8:** real world generation, checksum verification, settings validation, console rendering, shared types.
8. **M-8 + L-1/L-2/L-3:** fix build/deploy (Node 20+/systemd), rotate the SSH password, remove `wipe.js`/dev artifacts, add autostart.
9. Add the test suite in §9.

---

### Appendix — audit hygiene
Created and removed during testing: throwaway servers `injtest` (port 25599) and `audit-lc` (port 25600) with their directories, a temporary `tmux` session, and the injection-proof marker file. Only processes started by the audit were terminated. The original `test` server, all containers, and host services were left untouched. Final host state: one backend on `:3001`, `servers/` contains only `test`/`test-`, root filesystem 21% used. A copy of the RamsCraft DB was saved to `/tmp/rc_audit/dev.db.baseline` on the VM.
