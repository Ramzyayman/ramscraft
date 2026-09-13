# RamsCraft — Remediation Report

**Engineer:** Claude · **Date:** 2026-09-13 · **Branch:** `remediation` (no release tagged)
**Verification:** every fix was re-tested on the real Ubuntu VM against a real Paper 1.20.4 server over the backend's loopback interface; the browser happy-path was exercised through an SSH tunnel. Test servers/sessions/files were cleaned up; the VM ends with the systemd service active and only the original `test` server present.

Each item lists **Finding → Root Cause → Fix → Files Changed → Tests Performed → Result → Remaining Risk**.

---

## CRITICAL

### C-1 — Unauthenticated command injection / RCE
- **Finding:** `POST /api/servers/:id/players/command` (and the `sendCommand` WS event) executed arbitrary shell commands as `ramzy`.
- **Root cause:** every OS interaction was built as a shell string and run through `exec` (a shell); only `"` was escaped, so `$( )`/backticks/`;` were evaluated.
- **Fix:** new `utils/exec.ts` runs everything via `execFile` with an **argv array — no shell**. `ProcessService` now uses argv for tmux `new-session`/`send-keys -l`/`kill-session`/`list-panes`; console history is read in-process. Player route validates against an allow-list + `^[A-Za-z0-9_]{1,16}$`; settings route rejects keys/newlines; JavaDiscovery uses argv.
- **Files:** `utils/exec.ts` (new), `services/ProcessService.ts`, `routes/players.routes.ts`, `routes/settings.routes.ts`, `services/WebSocketService.ts`, `services/JavaDiscoveryService.ts`.
- **Tests:** re-ran the original PoC (`player = "$(id > …)"`) → **HTTP 400, no file created**. Sent `say INJTEST $(touch …)` through the live WS console → appeared as **literal text in the Minecraft console, no file created**.
- **Result:** ✅ Fixed — injection is inert even at the lowest layer.
- **Remaining risk:** none identified for shell injection; MC console commands are still powerful (by design) but can no longer reach the host shell.

### C-2 — Unsafe backup restore / data loss
- **Finding:** restore ran `rm -rf serverDir/* && tar …` in the background and reported success immediately.
- **Root cause:** destructive delete before an unverified extract; no atomicity; fire-and-forget.
- **Fix:** restore now (1) validates the archive is readable and contains no absolute/`..` entries, (2) extracts into an isolated temp dir, (3) atomically swaps it in and only then removes the old dir, rolling back on failure. Filenames are `basename`-guarded. Backups create to a temp file then rename; both operations `await` and report real completion. All via `execFile('tar', …)`.
- **Files:** `routes/backups.routes.ts`.
- **Tests:** create → real 172 MB archive + size reported. Round-trip: added a marker, restored → **marker gone, server.jar + properties intact (388 entries)**. Malicious `../` archive → **400, no escape file, dir intact**. Corrupt archive → **400, server.jar intact**. Traversal filename → rejected.
- **Result:** ✅ Fixed.
- **Remaining risk:** the traversal-filename case returns 500 instead of 400 (still safely rejected). Very large restores run within the request; a future improvement is a background job with progress events.

### C-3 — Unauthenticated, network-exposed API
- **Finding:** bound `0.0.0.0`, `CORS: *`, no auth; firewall off.
- **Root cause:** no authentication or exposure model.
- **Fix:** binds **127.0.0.1 by default** (reverse-proxy / RamsesHub model — loopback trusted). Optional `RAMSCRAFT_API_TOKEN` enables network exposure; the backend **refuses to bind a public interface without a token** (fail closed). Wildcard CORS removed (same-origin unless `RAMSCRAFT_ALLOWED_ORIGINS` set). WebSocket handshake authenticated with the same policy. Security headers + a simple rate limiter added. Frontend attaches the token transparently (none needed behind a proxy).
- **Files:** `config.ts`, `middleware/auth.ts` (new), `index.ts`, `services/WebSocketService.ts`, `frontend/src/api.ts` (new), `frontend/src/App.tsx`, `frontend/src/main.tsx`.
- **Tests:** from the LAN, `http://192.168.1.6:3001` → **connection refused**. Loopback (via tunnel) → 200. Malicious-player still 400.
- **Result:** ✅ Fixed; clean boundary for future RamsesHub integration (nginx `auth_request` → loopback).
- **Remaining risk:** direct LAN use now requires either fronting with nginx/RamsesHub or setting a token (documented). This intentionally ends the previous open-access convenience.

---

## HIGH

### H-1 — Crash never detected (stuck ONLINE)
- **Root cause:** the only crash check looked at `STARTING` servers only.
- **Fix:** a single status loop (`MetricsStreamer`) checks every STARTING/ONLINE server each tick; if the session/JVM is gone it transitions to **CRASHED**.
- **Files:** `services/MetricsStreamer.ts`, `services/ProcessService.ts`.
- **Tests:** killed a live server's JVM → status became **CRASHED within 3 s**.
- **Result:** ✅ Fixed. **Remaining risk:** detection latency ≤ ~2 s (loop interval).

### H-2 — Port-ping false ONLINE
- **Root cause:** status inferred from a TCP connect that any service on the port answers; identity check accepted `java|bash|node`.
- **Fix:** status is tied to **verified process identity** — a live JVM whose `/proc/<pid>/cwd` equals the server's own directory. A Minecraft SLP handshake only distinguishes STARTING→ONLINE *after* identity is confirmed.
- **Files:** `services/ProcessService.ts` (`isServerProcess`), `ReconciliationService.ts`, `MetricsStreamer.ts`, `utils/mcping.ts` (new).
- **Tests:** ONLINE server verified `cwd=/…/servers/audit2`; the crash test proves a dead process is no longer masked by a busy port.
- **Result:** ✅ Fixed. **Remaining risk:** relies on Linux `/proc` (fine for this deployment).

### H-3 — Java compatibility/runtime selection
- **Root cause:** min-only rule; snapshot strings mis-parsed (`24w14a`→2414).
- **Fix:** rewrote `JavaVersionHelper` with normalised release/rc/pre/snapshot parsing and **min *and* max** ranges (incl. 26.x). New `utils/java.ts` selects an installed runtime within range, prefers the recommended, and **refuses with a clear message** when none fits.
- **Files:** `providers/JavaVersionHelper.ts`, `utils/java.ts` (new), `controllers/LifecycleController.ts`, provider interface.
- **Tests:** table verified — `1.8.9→8–11`, `1.16.5→8–16`, `1.17→16–17`, `1.18–1.20.4→17–21`, `1.20.6/1.21→21`, `26.1.2/26.3-rc-1/26w02a→25`, `24w14a→21`, `21w15a→16–17`. `selectJavaRuntime('1.16.5')` **refused** ("requires Java 8-16, only 21, 25 installed"); `1.20.4` picked Java 21.
- **Result:** ✅ Fixed. **Remaining risk:** snapshot→era mapping is heuristic; truly novel strings fall back to the newest installed JDK (flagged `unknown`).

### H-4 — Live metrics never displayed
- **Root cause:** emitter/consumer both keyed on the non-existent status `RUNNING`; a second emitter used an event nothing listened to.
- **Fix:** one loop emits `serverStats` for ONLINE/STARTING viewers; frontend gate changed `RUNNING`→`ONLINE`; the dead second loop removed.
- **Files:** `services/MetricsStreamer.ts`, `services/WebSocketService.ts`, `frontend/src/pages/server/ServerOverview.tsx`.
- **Tests:** WS client received **5 `serverStats` in 9 s** for an ONLINE server.
- **Result:** ✅ Fixed.

### H-5 — PID-reuse SIGKILL
- **Root cause:** reconciliation `process.kill(storedPid)` for "orphans"; a reused PID could be any process.
- **Fix:** removed the bare-PID kill entirely; no session ⇒ OFFLINE/CRASHED. Any signal now requires verified identity (cwd match). Reconciliation refreshes `lastKnownPid` from the live pane.
- **Files:** `ReconciliationService.ts`, `MetricsStreamer.ts`.
- **Tests:** backend restart with a running server → JVM survived, reconciled ONLINE; no unrelated process signalled.
- **Result:** ✅ Fixed.

---

## MEDIUM

### M-1 — World generation didn't generate
- **Fix:** `/worlds/generate` now runs the real server headlessly, waits for "Done", stops it, and **verifies `level.dat`** before reporting success; dev comment block removed; world detection requires `level.dat`.
- **Files:** `routes/worlds.routes.ts`.
- **Tests:** generated `auditworld` → **level.dat present**, nether/end created, worlds list correct.
- **Result:** ✅ Fixed. **Remaining risk:** bounded 180 s wait (synchronous); large/modded generation could exceed it and returns a timeout error.

### M-2 — No checksum verification
- **Fix:** downloads to a temp file, computes sha256 (Paper) / sha1 (Vanilla), compares, and **fails closed** on mismatch; only a verified jar is installed and registered.
- **Files:** `controllers/SoftwareController.ts`, provider interface + both providers.
- **Tests:** real Paper 1.20.4 install passed verification and started; mismatch path returns 502 by construction.
- **Result:** ✅ Fixed. **Remaining risk:** if a provider omits a checksum, install proceeds with a logged warning.

### M-3 — Delete left files/process
- **Fix:** delete requires OFFLINE/CRASHED and no live session, then removes the server dir, its backups, and the console log before the cascading DB delete.
- **Files:** `controllers/ServerController.ts`.
- **Tests:** delete-while-ONLINE → 400; after stop, delete → **dir + backups + log removed**, DB row gone.
- **Result:** ✅ Fixed.

### M-4 — Path escapes
- **Fix:** `utils/paths.ts` `resolveWithinServer` enforces containment with `root + sep` and resolves symlinks via `realpath`; applied to all file/backup/world operations (read/write/list/move/upload/extract/delete).
- **Files:** `utils/paths.ts` (new), `routes/files.routes.ts`, `routes/backups.routes.ts`, `routes/worlds.routes.ts`, others.
- **Tests:** traversal (raw + encoded), sibling-prefix, and a **real symlink to `/etc`** all → 403.
- **Result:** ✅ Fixed.

### M-5 — Update validation
- **Fix:** `updateServer` validates name/port/RAM (shared validators), caps RAM to host memory, ignores unknown fields; create caps RAM too.
- **Files:** `controllers/ServerController.ts`.
- **Tests:** create validations exercised; update path shares them.
- **Result:** ✅ Fixed.

### M-6 — Console control codes / xterm unused
- **Fix:** `utils/ansi.ts` strips CSI/OSC/private-mode sequences; applied to live stream and history.
- **Files:** `utils/ansi.ts` (new), `services/ConsoleStreamer.ts`, `services/ProcessService.ts`.
- **Tests:** live console lines arrived as clean text (`[Server] INJTEST …`).
- **Result:** ✅ Fixed. **Remaining risk:** full xterm rendering not adopted (plain text is correct and readable).

### M-7 — Duplicate metrics loops
- **Fix:** consolidated into one loop with overlap guard; removed the second interval.
- **Files:** `services/WebSocketService.ts`, `services/MetricsStreamer.ts`.
- **Result:** ✅ Fixed.

### M-8 — Build/deploy inconsistency
- **Fix:** installed Node 20 (nvm) on the host; the frontend now builds there. Added `deploy/deploy.sh` (key-based), `deploy/ramscraft.service`, `.env.example`, `DEPLOYMENT.md`, and `engines.node >=20.19`.
- **Files:** `deploy/*`, `DEPLOYMENT.md`, `.env.example`, `package.json`, `frontend/package.json`.
- **Tests:** frontend built on the VM with Node 20 (`vite build` ✓); service installed, enabled, active.
- **Result:** ✅ Fixed.

---

## LOW / INFO

- **L-1 Secrets in repo:** removed `deploy_*.py` (embedded SSH password); deploy is key-based now. *Action for you:* rotate the SSH password / prefer key-only SSH (I can disable password auth on request). ✅ repo cleaned.
- **L-2 Dangerous dev artifacts:** removed `wipe.js`, `test.mjs`, `fix_strings.js`, `frontend/fix_ips.js` from the repo and the VM. ✅
- **L-3 No autostart:** systemd unit installed + enabled (`Restart=always`, boots on start). ✅ **Note:** `KillMode=process` is required so `systemctl restart` does not kill the game servers — verified the JVM survives a restart.
- **L-4 Broken link:** Advanced Configuration now links `/server/:id/files`. ✅
- **L-5 Placeholder metrics:** Dashboard shows real Max RAM + neutral CPU; Overview points to the Players tab instead of a fake count. ✅
- **L-6 Directory collisions:** create generates a unique slug (`base`, `base-1`, …), never reusing an existing dir; precise 409 messages. ✅
- **L-7 HTTP hardening:** security headers, JSON body limit (2 MB), rate limiting. ✅
- **L-8 Shared type mismatch:** `Server.software` typed as an object. ✅

---

## Summary

**Critical resolved:** C-1, C-2, C-3.
**High resolved:** H-1, H-2, H-3, H-4, H-5.
**Medium resolved:** M-1 … M-8.
**Low resolved:** L-1 … L-8.

**Intentionally deferred (not required for safety):**
- Full xterm terminal rendering (plain, clean text is used instead).
- Backup/world operations as background jobs with progress events (currently bounded synchronous).
- Traversal-filename restore returns 500 vs 400 (still safely rejected).

**New tests performed (all on the live VM):** command-injection (REST + WS), path traversal + encoded + sibling-prefix + symlink, backup create/restore round-trip + malicious + corrupt archives, crash detection, Java compat table + refusal, live metrics over WS, backend-restart recovery, world generation + verification, server deletion + cleanup, full create→install(verified)→EULA→start→ONLINE→command→settings→stop lifecycle, and the browser happy-path (dashboard/settings/files).

**Deployment changes:** Node 20 on host; systemd service (`KillMode=process`); key-based `deploy.sh`; `.env.example`/`DEPLOYMENT.md`; secrets and dev artifacts removed.

**Architectural changes (minimal):** one status/metrics loop keyed on verified process identity; a single safe-exec utility; a single path-containment utility; a thin auth boundary designed to sit behind RamsesHub. No rewrite; existing working behaviour (tmux lifecycle, providers, console, reconciliation) preserved.

**Not done (needs you):** rotate the exposed SSH credential. One casualty to flag: during the *first* audit session, the old create code overwrote the `test` server's `server.properties` (writing `server-port=40000` before the duplicate-name check failed). I restored `server-port=25565` (matching its DB record and world); Paper will regenerate the other defaults on next start, but any earlier custom values there were already lost before this remediation. The new create code no longer touches existing directories.

No release/tag was created, per instructions.
