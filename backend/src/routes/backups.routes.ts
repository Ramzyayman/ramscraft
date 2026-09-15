import { Router } from 'express';
import { prisma } from '../index';
import fs from 'fs';
import path from 'path';
import { ServerStatus } from '@ramscraft/shared';
import { serverRoot } from '../utils/paths';
import { run } from '../utils/exec';
import { processService } from '../services/ProcessService';
import { wsService } from '../services/WebSocketService';
import { isInstalling } from '../services/SoftwareInstallService';
import { runTar } from '../utils/tar';
import { selectJavaRuntime } from '../utils/java';
import { launchFilePresent, readLaunchConfig, writeLaunchConfig } from '../providers/launch';
import { providerRegistry } from '../providers/ProviderRegistry';
import { detectSoftware, setServerPort } from '../services/detectSoftware';
import {
    CHUNK_BYTES, HttpError, cancelUpload, finishUpload, getUpload, startUpload, uploadStatus, writeChunk,
} from '../services/backupUpload';

const router = Router();

/** Broadcast `backupProgress` {serverId, operation, phase, percent}; only sends when phase or percent changes. */
function progressReporter(serverId: string, operation: 'create' | 'restore') {
    let last = '';
    return (phase: string, percent: number) => {
        const p = Math.max(0, Math.min(99, Math.floor(percent)));
        if (`${phase}:${p}` === last) return;
        last = `${phase}:${p}`;
        wsService.io?.emit('backupProgress', { serverId, operation, phase, percent: p });
    };
}

function backupDirFor(directoryName: string): string {
    // Sibling of the server directory: <serversRoot>/<directoryName>_backups
    const dir = serverRoot(directoryName) + '_backups';
    return dir;
}

/** Resolve a backup filename to an absolute path, guaranteeing it stays in the backup dir. */
function backupFilePath(directoryName: string, file: string): string {
    const base = path.basename(file); // strip any path components
    if (base !== file || !base.endsWith('.tar.gz')) {
        throw new Error('Invalid backup filename');
    }
    return path.join(backupDirFor(directoryName), base);
}

/**
 * Point RamsCraft at the software found in a restored folder: how to start it, the Minecraft version
 * and a matching Java. Returns what was detected, and a warning when the user needs to step in.
 */
async function adoptSoftware(server: { id: string; javaRuntimeId: string | null }, serverDir: string) {
    const detected = detectSoftware(serverDir);
    if (!detected) {
        return { software: null, warning: 'No server software was found in this backup. Install one with Change Software; your files are kept.' };
    }
    const hasOwnLaunchConfig = fs.existsSync(path.join(serverDir, '.ramscraft', 'launch.json'));
    if (!hasOwnLaunchConfig || !launchFilePresent(serverDir, readLaunchConfig(serverDir))) {
        writeLaunchConfig(serverDir, detected.launch);
    }

    const previous = await prisma.software.findUnique({ where: { serverId: server.id } });
    const mcVersion = detected.mcVersion ?? previous?.mcVersion ?? 'unknown';
    const data = { provider: detected.provider, mcVersion, releaseId: detected.releaseId, installerUrl: null };
    await prisma.software.upsert({ where: { serverId: server.id }, update: data, create: { serverId: server.id, ...data } });

    let warning: string | null = detected.mcVersion ? null
        : 'The Minecraft version could not be detected. If the server does not start, reinstall its software with Change Software.';
    let java: number | null = null;
    try {
        const selected = await selectJavaRuntime(mcVersion);
        await prisma.server.update({ where: { id: server.id }, data: { javaRuntimeId: selected.id } });
        java = selected.majorVersion;
    } catch (e: any) {
        warning = e.message;
    }
    return { software: { ...data, providerName: providerRegistry.get(detected.provider).name, java }, warning };
}

router.get('/:id/backups', async (req, res) => {
    try {
        const server = await prisma.server.findUnique({ where: { id: req.params.id } });
        if (!server) return res.status(404).json({ error: 'Server not found' });
        const dir = backupDirFor(server.directoryName);
        if (!fs.existsSync(dir)) return res.json([]);
        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.tar.gz'))
            .map(f => {
                const stat = fs.statSync(path.join(dir, f));
                return { name: f, size: stat.size, createdAt: stat.mtime };
            })
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        res.json(files);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/:id/backups', async (req, res) => {
    try {
        const server = await prisma.server.findUnique({ where: { id: req.params.id } });
        if (!server) return res.status(404).json({ error: 'Not found' });
        const serverDir = serverRoot(server.directoryName);
        if (!fs.existsSync(serverDir)) return res.status(400).json({ error: 'Server directory does not exist' });

        const dir = backupDirFor(server.directoryName);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const backupName = `backup_${Date.now()}.tar.gz`;
        const tmpPath = path.join(dir, `.${backupName}.partial`);
        const finalPath = path.join(dir, backupName);

        const report = progressReporter(server.id, 'create');
        report('Preparing', 0);
        const du = await run('du', ['-sb', serverDir], { timeoutMs: 60_000 });
        const totalBytes = parseInt(du.stdout, 10) || 1;

        // Create the archive to a temp file, then atomically rename on success so a
        // failed/partial archive is never presented as a valid backup.
        const r = await runTar(['-czf', tmpPath, '-C', serverDir, '.'], { totalBytes, onProgress: p => report('Archiving', p) });
        if (r.code !== 0) {
            if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
            return res.status(500).json({ error: `Backup failed: ${r.stderr || 'tar error'}` });
        }
        fs.renameSync(tmpPath, finalPath);
        const size = fs.statSync(finalPath).size;
        res.json({ success: true, name: backupName, size });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/:id/backups/:file/restore', async (req, res) => {
    let tmpDir: string | null = null;
    try {
        const server = await prisma.server.findUnique({ where: { id: req.params.id } });
        if (!server) return res.status(404).json({ error: 'Not found' });
        if (server.status !== ServerStatus.OFFLINE && server.status !== ServerStatus.CRASHED) {
            return res.status(400).json({ error: 'Server must be OFFLINE to restore a backup' });
        }
        if (isInstalling(server.id)) return res.status(409).json({ error: 'Software is being installed. Restore when it finishes.' });
        // Belt and braces: never restore over a live process.
        if (await processService.hasSession(server.id)) {
            return res.status(400).json({ error: 'Server process is still running; stop it before restoring.' });
        }

        const serverDir = serverRoot(server.directoryName);
        const targetFile = backupFilePath(server.directoryName, req.params.file);
        if (!fs.existsSync(targetFile)) return res.status(404).json({ error: 'Backup not found' });

        const report = progressReporter(server.id, 'restore');

        // 1. Verify the archive is readable and contains no unsafe (absolute / ..) paths.
        const list = await runTar(['-tzf', '-'], { input: targetFile, onProgress: p => report('Verifying', p) });
        if (list.code !== 0) return res.status(400).json({ error: 'Backup archive is unreadable or corrupt' });
        const entries = list.stdout.split('\n').map(s => s.trim()).filter(Boolean);
        if (entries.length === 0) return res.status(400).json({ error: 'Backup archive is empty' });
        for (const entry of entries) {
            const norm = entry.replace(/\\/g, '/');
            if (norm.startsWith('/') || norm.split('/').some(seg => seg === '..')) {
                return res.status(400).json({ error: 'Backup archive contains unsafe paths; refusing to restore' });
            }
        }

        // 2. Extract into an isolated temp dir (never touch the live dir until success).
        tmpDir = `${serverDir}.restore-${Date.now()}`;
        fs.mkdirSync(tmpDir, { recursive: true });
        const ext = await runTar(['-xzf', '-', '-C', tmpDir, '--no-same-owner'], { input: targetFile, onProgress: p => report('Extracting', p) });
        if (ext.code !== 0) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            tmpDir = null;
            return res.status(500).json({ error: `Restore extraction failed: ${ext.stderr || 'tar error'}` });
        }

        // 3. Atomic-ish swap: move current dir aside, move restored dir in, delete old.
        const oldDir = `${serverDir}.old-${Date.now()}`;
        if (fs.existsSync(serverDir)) fs.renameSync(serverDir, oldDir);
        try {
            fs.renameSync(tmpDir, serverDir);
        } catch (swapErr) {
            // Roll back to the original on failure.
            if (fs.existsSync(oldDir) && !fs.existsSync(serverDir)) fs.renameSync(oldDir, serverDir);
            throw swapErr;
        }
        tmpDir = null;
        if (fs.existsSync(oldDir)) fs.rmSync(oldDir, { recursive: true, force: true });

        // A backup may come from another machine: keep this server's port and adopt the software it contains.
        setServerPort(serverDir, server.port);
        const adopted = await adoptSoftware(server, serverDir);

        res.json({ success: true, message: 'Restore complete', entries: entries.length, ...adopted });
    } catch (e: any) {
        if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
        res.status(500).json({ error: e.message });
    }
});

// ---------------------------------------------------------------- uploaded backups (chunked)

const sendError = (res: any, e: any, extra: object = {}) =>
    res.status(e instanceof HttpError ? e.status : 500).json({ error: e.message, ...extra });

router.post('/:id/backups/upload', async (req, res) => {
    try {
        const server = await prisma.server.findUnique({ where: { id: req.params.id } });
        if (!server) return res.status(404).json({ error: 'Server not found' });
        const { filename, size } = req.body ?? {};
        if (typeof filename !== 'string' || filename.length > 255) return res.status(400).json({ error: 'Invalid file name' });
        const upload = startUpload(server.id, backupDirFor(server.directoryName), filename, size);
        res.status(201).json({ uploadId: upload.id, chunkSize: CHUNK_BYTES });
    } catch (e: any) {
        sendError(res, e);
    }
});

// Raw bytes (application/octet-stream), sent in order: ?offset=<bytes already received>
router.put('/:id/backups/upload/:uploadId', async (req, res) => {
    const upload = getUpload(req.params.id, req.params.uploadId);
    if (!upload) return res.status(404).json({ error: 'Upload not found. It may have expired; start it again.' });
    try {
        await writeChunk(upload, Number(req.query.offset), req);
        res.json({ received: upload.received });
    } catch (e: any) {
        sendError(res, e, { received: upload.received });
    }
});

router.post('/:id/backups/upload/:uploadId/complete', (req, res) => {
    const upload = getUpload(req.params.id, req.params.uploadId);
    if (!upload) return res.status(404).json({ error: 'Upload not found. It may have expired; start it again.' });
    try {
        finishUpload(upload);
        res.status(202).json(uploadStatus(upload));
    } catch (e: any) {
        sendError(res, e);
    }
});

router.get('/:id/backups/upload/:uploadId', (req, res) => {
    const upload = getUpload(req.params.id, req.params.uploadId);
    if (!upload) return res.status(404).json({ error: 'Upload not found' });
    res.json(uploadStatus(upload));
});

router.delete('/:id/backups/upload/:uploadId', (req, res) => {
    const upload = getUpload(req.params.id, req.params.uploadId);
    if (upload) cancelUpload(upload);
    res.json({ success: true });
});

router.delete('/:id/backups/:file', async (req, res) => {
    try {
        const server = await prisma.server.findUnique({ where: { id: req.params.id } });
        if (!server) return res.status(404).json({ error: 'Not found' });
        
        const targetFile = backupFilePath(server.directoryName, req.params.file);
        if (!fs.existsSync(targetFile)) return res.status(404).json({ error: 'Backup not found' });
        
        fs.rmSync(targetFile, { force: true });
        res.json({ success: true, message: 'Backup deleted successfully' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
