import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { run } from '../utils/exec';
import { runTar } from '../utils/tar';

/**
 * Uploaded backups: a .zip/.tar.gz of a server folder (e.g. from someone's PC) arrives in chunks
 * (Cloudflare allows 100 MB per request), is checked, unwrapped and stored as a normal RamsCraft
 * backup (<servers>/<dir>_backups/upload_<time>_<name>.tar.gz) that the existing Restore uses.
 */

export const CHUNK_BYTES = 50 * 1024 ** 2;
export const MAX_UPLOAD_BYTES = 50 * 1024 ** 3;
const STALE_MS = 24 * 60 * 60_000;
const FREE_SPACE_MARGIN = 1024 ** 3;

export class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
}

export type ArchiveKind = 'zip' | 'tar.gz';

export function archiveKind(filename: string): ArchiveKind | null {
    const name = filename.toLowerCase();
    if (name.endsWith('.zip')) return 'zip';
    if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) return 'tar.gz';
    return null;
}

/** Absolute paths, Windows drive letters and `..` segments are refused. */
export function unsafeEntry(name: string): boolean {
    const n = name.replace(/\\/g, '/');
    return n.startsWith('/') || /^[A-Za-z]:/.test(n) || n.split('/').includes('..');
}

const JUNK = new Set(['__MACOSX', '.DS_Store', 'Thumbs.db', 'desktop.ini']);
const SERVER_MARKERS = /^(server\.properties|eula\.txt|libraries|mods|plugins|run\.sh|run\.bat|user_jvm_args\.txt)$|\.jar$/i;

/** The folder holding the server files: the archive root, or the folder(s) it is wrapped in ("MyServer/..."). */
export function findServerRoot(dir: string): string | null {
    let root = dir;
    for (let depth = 0; depth < 5; depth++) {
        const names = fs.readdirSync(root).filter(n => !JUNK.has(n));
        if (names.some(n => SERVER_MARKERS.test(n))) return root;
        if (names.length !== 1) return null;
        const only = path.join(root, names[0]);
        if (!fs.lstatSync(only).isDirectory()) return null;
        root = only;
    }
    return null;
}

export function findSymlink(dir: string): string | null {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) return p;
        if (entry.isDirectory()) {
            const found = findSymlink(p);
            if (found) return found;
        }
    }
    return null;
}

function freeBytes(dir: string): number {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize;
}

function requireFreeSpace(dir: string, bytes: number) {
    const free = freeBytes(dir);
    if (free < bytes + FREE_SPACE_MARGIN) {
        const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
        throw new HttpError(507, `Not enough disk space on the VM: needs about ${gb(bytes + FREE_SPACE_MARGIN)}, ${gb(free)} free.`);
    }
}

const slug = (filename: string) =>
    filename.replace(/\.(zip|tar\.gz|tgz)$/i, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'server';

// ---------------------------------------------------------------- upload state

export interface Upload {
    id: string;
    serverId: string;
    backupDir: string;
    originalName: string;
    kind: ArchiveKind;
    size: number;
    received: number;
    file: string;
    state: 'uploading' | 'processing' | 'done' | 'error';
    phase: string;
    percent: number;
    error?: string;
    backupName?: string;
    busy: boolean;
    updatedAt: number;
}

// ponytail: in memory, so a backend restart drops unfinished uploads (their files are swept after a day).
const uploads = new Map<string, Upload>();

export function uploadStatus(u: Upload) {
    const { id, originalName, size, received, state, phase, percent, error, backupName } = u;
    return { id, originalName, size, received, state, phase, percent, error, backupName };
}

export function getUpload(serverId: string, uploadId: string): Upload | null {
    const u = uploads.get(uploadId);
    return u && u.serverId === serverId ? u : null;
}

/** Remove leftovers of uploads that were abandoned (browser closed, backend restarted). */
function sweep(backupDir: string) {
    const now = Date.now();
    for (const [id, u] of uploads) {
        if (now - u.updatedAt > STALE_MS && u.state !== 'processing') cancelUpload(u);
        else if (u.state === 'done' || u.state === 'error') if (now - u.updatedAt > 60 * 60_000) uploads.delete(id);
    }
    if (!fs.existsSync(backupDir)) return;
    for (const name of fs.readdirSync(backupDir)) {
        if (!name.startsWith('.upload-')) continue;
        const p = path.join(backupDir, name);
        const id = name.slice('.upload-'.length).split(/[.-]/)[0];
        if (!uploads.has(id) && now - fs.statSync(p).mtimeMs > STALE_MS) fs.rmSync(p, { recursive: true, force: true });
    }
}

export function startUpload(serverId: string, backupDir: string, originalName: string, size: number): Upload {
    const kind = archiveKind(originalName);
    if (!kind) throw new HttpError(400, 'Upload a .zip or .tar.gz file of the server folder.');
    if (!Number.isSafeInteger(size) || size <= 0) throw new HttpError(400, 'Invalid file size.');
    if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Backups larger than 50 GB are not supported.');
    fs.mkdirSync(backupDir, { recursive: true });
    sweep(backupDir);
    // The upload, its extracted files and the new backup all sit on disk at once.
    requireFreeSpace(backupDir, size * 3);

    const id = crypto.randomBytes(12).toString('hex');
    const file = path.join(backupDir, `.upload-${id}.part`);
    fs.writeFileSync(file, '');
    const u: Upload = {
        id, serverId, backupDir, originalName, kind, size, received: 0, file,
        state: 'uploading', phase: 'Uploading', percent: 0, busy: false, updatedAt: Date.now(),
    };
    uploads.set(id, u);
    return u;
}

/** Append one chunk. Chunks must arrive in order; a failed chunk can simply be sent again. */
export async function writeChunk(u: Upload, offset: number, body: NodeJS.ReadableStream): Promise<void> {
    if (u.state !== 'uploading') throw new HttpError(409, 'This upload is no longer accepting data.');
    if (u.busy) throw new HttpError(409, 'Another chunk of this upload is still being written.');
    if (offset !== u.received) throw new HttpError(409, `Expected data at byte ${u.received}.`);
    u.busy = true;
    try {
        fs.truncateSync(u.file, u.received); // drop whatever a failed attempt at this chunk left behind
        let written = 0;
        const limit = new Transform({
            transform(chunk: Buffer, _enc, done) {
                written += chunk.length;
                if (written > CHUNK_BYTES || u.received + written > u.size) return done(new HttpError(413, 'Chunk is larger than expected.'));
                done(null, chunk);
            },
        });
        await pipeline(body, limit, fs.createWriteStream(u.file, { flags: 'a' }));
        u.received += written;
        u.percent = Math.floor(u.received / u.size * 100);
        u.updatedAt = Date.now();
    } finally {
        u.busy = false;
    }
}

export function cancelUpload(u: Upload) {
    uploads.delete(u.id);
    if (u.state !== 'processing') fs.rmSync(u.file, { force: true });
}

export function finishUpload(u: Upload) {
    if (u.state !== 'uploading') throw new HttpError(409, 'This upload was already completed.');
    if (u.busy || u.received !== u.size) throw new HttpError(400, `Upload incomplete: ${u.received} of ${u.size} bytes received.`);
    u.state = 'processing';
    setPhase(u, 'Checking archive', 0);
    void processUpload(u);
}

function setPhase(u: Upload, phase: string, percent: number) {
    u.phase = phase;
    u.percent = Math.max(0, Math.min(99, Math.floor(percent)));
    u.updatedAt = Date.now();
}

// ---------------------------------------------------------------- conversion

/** Run unzip and turn its per-file output lines into progress. Exit code 1 means warnings only. */
function runUnzip(args: string[], totalEntries: number, onProgress: (percent: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn('unzip', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let done = 0, pending = '', stderr = '';
        const timer = setTimeout(() => child.kill('SIGKILL'), 2 * 60 * 60_000);
        child.stdout.on('data', (b: Buffer) => {
            const lines = (pending + b.toString()).split('\n');
            pending = lines.pop() ?? '';
            done += lines.filter(l => /^\s*(inflating|extracting|creating|linking):/.test(l)).length;
            onProgress(done / Math.max(1, totalEntries) * 100);
        });
        child.stderr.on('data', (b: Buffer) => { stderr = (stderr + b.toString()).slice(-2000); });
        child.on('error', e => { clearTimeout(timer); reject(e); });
        child.on('close', code => {
            clearTimeout(timer);
            if (code === 0 || code === 1) resolve();
            else reject(new Error(code === 82 || /password/i.test(stderr)
                ? 'The zip is password protected. Upload a zip without a password.'
                : `Could not extract the zip (unzip exit ${code}): ${stderr.trim() || 'unknown error'}`));
        });
    });
}

async function extractZip(u: Upload, dest: string) {
    const totals = await run('unzip', ['-Zt', u.file], { timeoutMs: 10 * 60_000 });
    const m = totals.stdout.match(/(\d+) files?, (\d+) bytes? uncompressed/);
    if (totals.code !== 0 || !m) throw new Error('This is not a readable .zip file.');
    requireFreeSpace(dest, Number(m[2]) * 2);

    const list = await run('unzip', ['-Z1', u.file], { timeoutMs: 10 * 60_000 });
    if (list.code !== 0) throw new Error('This is not a readable .zip file.');
    if (list.stdout.split('\n').filter(Boolean).some(unsafeEntry)) {
        throw new Error('The zip contains unsafe paths (absolute or "..") and was refused.');
    }
    // -P '' fails password-protected entries instead of prompting for a password.
    await runUnzip(['-o', '-P', '', u.file, '-d', dest], Number(m[1]), p => setPhase(u, 'Extracting', p));
}

async function extractTarGz(u: Upload, dest: string) {
    const list = await runTar(['-tzf', '-'], { input: u.file, onProgress: p => setPhase(u, 'Checking archive', p) });
    if (list.code !== 0) throw new Error('This is not a readable .tar.gz file.');
    if (list.stdout.split('\n').filter(Boolean).some(unsafeEntry)) {
        throw new Error('The archive contains unsafe paths (absolute or "..") and was refused.');
    }
    // Links could point outside the server folder: refuse archives that contain any.
    const verbose = await runTar(['-tvzf', '-'], { input: u.file, onProgress: () => {} });
    if (verbose.stdout.split('\n').some(l => l.startsWith('l') || l.startsWith('h'))) {
        throw new Error('The archive contains links, which RamsCraft does not restore for safety.');
    }
    requireFreeSpace(dest, u.size * 2);
    const r = await runTar(['-xzf', '-', '-C', dest, '--no-same-owner'], { input: u.file, onProgress: p => setPhase(u, 'Extracting', p) });
    if (r.code !== 0) throw new Error(`Could not extract the archive: ${r.stderr.trim() || 'tar error'}`);
}

async function processUpload(u: Upload) {
    const workDir = path.join(u.backupDir, `.upload-${u.id}-extract`);
    try {
        fs.rmSync(workDir, { recursive: true, force: true });
        fs.mkdirSync(workDir);
        if (u.kind === 'zip') await extractZip(u, workDir);
        else await extractTarGz(u, workDir);

        if (findSymlink(workDir)) throw new Error('The archive contains symbolic links, which RamsCraft does not restore for safety.');
        const root = findServerRoot(workDir);
        if (!root) {
            throw new Error("This doesn't look like a Minecraft server folder: no server.properties, server .jar, mods, plugins or libraries "
                + 'at the top of the archive. To add only a world, use Worlds → Import.');
        }
        fs.rmSync(path.join(root, '__MACOSX'), { recursive: true, force: true });

        setPhase(u, 'Creating backup', 0);
        const du = await run('du', ['-sb', root], { timeoutMs: 10 * 60_000 });
        const name = `upload_${Date.now()}_${slug(u.originalName)}.tar.gz`;
        const partial = path.join(u.backupDir, `.${name}.partial`);
        const r = await runTar(['-czf', partial, '-C', root, '.'], {
            totalBytes: parseInt(du.stdout, 10) || 1,
            onProgress: p => setPhase(u, 'Creating backup', p),
        });
        if (r.code !== 0) {
            fs.rmSync(partial, { force: true });
            throw new Error(`Could not create the backup: ${r.stderr.trim() || 'tar error'}`);
        }
        fs.renameSync(partial, path.join(u.backupDir, name));
        u.backupName = name;
        u.state = 'done';
        u.phase = 'Done';
        u.percent = 100;
    } catch (e: any) {
        u.state = 'error';
        u.error = e.message;
    } finally {
        u.updatedAt = Date.now();
        fs.rmSync(workDir, { recursive: true, force: true });
        fs.rmSync(u.file, { force: true });
    }
}
