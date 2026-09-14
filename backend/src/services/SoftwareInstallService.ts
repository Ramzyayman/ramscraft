import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { once } from 'events';
import { prisma } from '../index';
import { config } from '../config';
import { serverRoot } from '../utils/paths';
import { stripAnsi } from '../utils/ansi';
import { selectJavaRuntime } from '../utils/java';
import { wsService } from './WebSocketService';
import { processService } from './ProcessService';
import { HashAlgo, ISoftwareProvider, ISoftwareRelease, InstallContext } from '../providers/ISoftwareProvider';
import { writeLaunchConfig } from '../providers/launch';
import { installFiles } from './installFiles';
import { USER_AGENT } from '../providers/http';

export interface InstallJob {
    serverId: string;
    state: 'running' | 'done' | 'error';
    provider: string;
    providerName: string;
    mcVersion: string;
    releaseId: string;
    phase: string;
    percent: number | null;
    detail: string;
    error?: string;
    startedAt: number;
    finishedAt?: number;
}

// ponytail: in-memory, so a backend restart forgets finished jobs (the Software row is the durable record).
const jobs = new Map<string, InstallJob>();
const lastEmitAt = new Map<string, number>();

export const getInstallJob = (serverId: string) => jobs.get(serverId) ?? null;
export const isInstalling = (serverId: string) => jobs.get(serverId)?.state === 'running';

function emit(job: InstallJob, force = false) {
    const now = Date.now();
    if (!force && now - (lastEmitAt.get(job.serverId) ?? 0) < 250) return;
    lastEmitAt.set(job.serverId, now);
    wsService.io?.emit('softwareProgress', job);
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Progress = (phase: string, percent?: number | null, detail?: string) => void;

/** Streamed download with checksum verification, a stall timeout and retries; writes dest only when complete. */
async function download(url: string, dest: string, opts: { checksum?: string; algo?: HashAlgo; label?: string; quiet?: boolean }, progress: Progress) {
    const label = opts.label ?? `Downloading ${path.basename(dest)}`;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.part`;
    let lastError: any;

    for (let attempt = 1; attempt <= 3; attempt++) {
        const abort = new AbortController();
        let stall = setTimeout(() => abort.abort(), 60_000);
        try {
            const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: abort.signal });
            if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
            const total = Number(res.headers.get('content-length')) || 0;
            const hash = opts.algo && opts.checksum ? crypto.createHash(opts.algo) : null;
            const out = fs.createWriteStream(tmp);
            let received = 0, reportedAt = 0;
            try {
                for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
                    clearTimeout(stall);
                    stall = setTimeout(() => abort.abort(), 60_000);
                    received += chunk.length;
                    hash?.update(chunk);
                    if (!out.write(chunk)) await once(out, 'drain');
                    if (!opts.quiet && Date.now() - reportedAt > 250) {
                        reportedAt = Date.now();
                        progress(label, total ? received / total * 100 : null, total ? `${mb(received)} of ${mb(total)}` : mb(received));
                    }
                }
            } finally {
                out.end();
                await once(out, 'close');
            }
            clearTimeout(stall);
            if (hash && opts.checksum && hash.digest('hex').toLowerCase() !== opts.checksum.toLowerCase()) {
                throw new Error(`${opts.algo} checksum mismatch`);
            }
            fs.renameSync(tmp, dest);
            return;
        } catch (e: any) {
            clearTimeout(stall);
            fs.rmSync(tmp, { force: true });
            lastError = e;
            if (attempt < 3) await sleep(1500 * attempt);
        }
    }
    const reason = lastError?.name === 'AbortError' ? 'the connection stalled' : lastError?.message;
    throw new Error(`${label} failed after 3 attempts: ${reason} (${new URL(url).host})`);
}

/** Run an installer (argv, no shell) with the chosen Java first on PATH, streaming output lines as progress. */
function runProcess(file: string, args: string[], opts: { cwd: string; label: string; timeoutMs?: number; until?: RegExp }, progress: Progress): Promise<void> {
    return new Promise((resolve, reject) => {
        const binDir = path.dirname(file);
        const child = spawn(file, args, {
            cwd: opts.cwd,
            env: { ...process.env, JAVA_HOME: path.dirname(binDir), PATH: `${binDir}:${process.env.PATH ?? ''}` },
        });
        const tail: string[] = [];
        let pending = '', matched = false, reportedAt = 0;

        const onData = (buf: Buffer) => {
            const lines = (pending + buf.toString()).split(/\r?\n|\r/);
            pending = lines.pop() ?? '';
            for (const raw of lines) {
                const line = stripAnsi(raw).trim();
                if (!line) continue;
                tail.push(line);
                if (tail.length > 20) tail.shift();
                if (Date.now() - reportedAt > 250) {
                    reportedAt = Date.now();
                    progress(opts.label, null, line.slice(0, 200));
                }
                if (opts.until && !matched && opts.until.test(line)) {
                    matched = true;
                    child.kill('SIGTERM');
                    setTimeout(() => child.kill('SIGKILL'), 15_000).unref();
                }
            }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);

        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`${opts.label} timed out`));
        }, opts.timeoutMs ?? 15 * 60_000);

        child.on('error', e => {
            clearTimeout(timer);
            reject(new Error(`${opts.label}: could not start ${path.basename(file)} (${e.message})`));
        });
        child.on('close', code => {
            clearTimeout(timer);
            if (matched || code === 0) resolve();
            else reject(new Error(`${opts.label} failed (exit code ${code}): ${tail.slice(-4).join(' | ')}`));
        });
    });
}

export function startInstall(
    server: { id: string; directoryName: string },
    provider: ISoftwareProvider,
    mcVersion: string,
    release: ISoftwareRelease,
): InstallJob {
    if (isInstalling(server.id)) throw new Error('A software installation is already running for this server.');
    const job: InstallJob = {
        serverId: server.id, state: 'running', provider: provider.id, providerName: provider.name,
        mcVersion, releaseId: release.id, phase: 'Starting', percent: null, detail: '', startedAt: Date.now(),
    };
    jobs.set(server.id, job);
    emit(job, true);
    void runInstall(job, server, provider, release);
    return job;
}

async function runInstall(job: InstallJob, server: { id: string; directoryName: string }, provider: ISoftwareProvider, release: ISoftwareRelease) {
    const serverDir = serverRoot(server.directoryName);
    const stagingDir = path.join(serverDir, '.ramscraft', `install-${Date.now()}`);
    const progress: Progress = (phase, percent = null, detail = '') => {
        job.phase = phase;
        job.percent = percent == null ? null : Math.max(0, Math.min(100, Math.round(percent)));
        job.detail = detail;
        emit(job);
    };

    try {
        fs.mkdirSync(stagingDir, { recursive: true });
        fs.mkdirSync(config.cacheDir, { recursive: true });

        // A plain object of arrow functions: providers may spread it (modpacks reuse it for their loader).
        const ctx: InstallContext = {
            stagingDir,
            cacheDir: config.cacheDir,
            mcVersion: job.mcVersion,
            release,
            java: async (mc?: string) => (await selectJavaRuntime(mc ?? job.mcVersion)).path,
            progress,
            download: (url, dest, opts = {}) => download(url, dest, opts, progress),
            run: (file, args, opts) => runProcess(file, args, opts, progress),
        };

        const result = await provider.install(ctx);
        const mcVersion = result.mcVersion ?? job.mcVersion;
        const java = await selectJavaRuntime(mcVersion);

        if (await processService.hasSession(server.id)) {
            throw new Error('The server was started during installation, so its files were left unchanged. Stop it and install again.');
        }

        progress('Installing files into the server');
        installFiles(stagingDir, serverDir, result);
        writeLaunchConfig(serverDir, result.launch);

        const data = { provider: provider.id, mcVersion, releaseId: result.releaseLabel ?? release.id, installerUrl: result.sourceUrl ?? null };
        await prisma.software.upsert({ where: { serverId: server.id }, update: data, create: { serverId: server.id, ...data } });
        await prisma.server.update({ where: { id: server.id }, data: { javaRuntimeId: java.id } });

        job.mcVersion = mcVersion;
        job.releaseId = data.releaseId;
        job.state = 'done';
        progress(`Installed ${provider.name}`, 100, `Minecraft ${mcVersion} · Java ${java.majorVersion}`);
    } catch (e: any) {
        job.state = 'error';
        job.error = e.message;
        job.phase = 'Installation failed';
        job.detail = '';
        console.error(`[Software] ${provider.id} install for server ${server.id} failed: ${e.message}`);
    } finally {
        job.finishedAt = Date.now();
        fs.rmSync(stagingDir, { recursive: true, force: true });
        emit(job, true);
    }
}
