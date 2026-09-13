import { Router } from 'express';
import { prisma } from '../index';
import fs from 'fs';
import path from 'path';
import { ServerStatus } from '@ramscraft/shared';
import { serverRoot } from '../utils/paths';
import { run } from '../utils/exec';
import { processService } from '../services/ProcessService';

const router = Router();

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

        // Create the archive to a temp file, then atomically rename on success so a
        // failed/partial archive is never presented as a valid backup.
        const r = await run('tar', ['-czf', tmpPath, '-C', serverDir, '.'], { timeoutMs: 30 * 60_000 });
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
        // Belt and braces: never restore over a live process.
        if (await processService.hasSession(server.id)) {
            return res.status(400).json({ error: 'Server process is still running; stop it before restoring.' });
        }

        const serverDir = serverRoot(server.directoryName);
        const targetFile = backupFilePath(server.directoryName, req.params.file);
        if (!fs.existsSync(targetFile)) return res.status(404).json({ error: 'Backup not found' });

        // 1. Verify the archive is readable and contains no unsafe (absolute / ..) paths.
        const list = await run('tar', ['-tzf', targetFile], { timeoutMs: 5 * 60_000 });
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
        const ext = await run('tar', ['-xzf', targetFile, '-C', tmpDir, '--no-same-owner'], { timeoutMs: 30 * 60_000 });
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

        res.json({ success: true, message: 'Restore complete', entries: entries.length });
    } catch (e: any) {
        if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
        res.status(500).json({ error: e.message });
    }
});

export default router;
