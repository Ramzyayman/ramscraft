import { Router } from 'express';
import { prisma } from '../index';
import fs from 'fs';
import path from 'path';
import { ServerStatus } from '@ramscraft/shared';
import { serverRoot } from '../utils/paths';
import { run } from '../utils/exec';
import { processService } from '../services/ProcessService';
import { wsService } from '../services/WebSocketService';
import { spawn } from 'child_process';

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

/**
 * Run tar (argv, no shell) while reporting progress in percent:
 *  - `input`: the archive is streamed into tar's stdin, so progress = archive bytes read.
 *  - `totalBytes`: GNU tar prints a checkpoint every 1000 records (10 KiB each), i.e. bytes archived.
 */
function runTar(args: string[], opts: { input?: string; totalBytes?: number; onProgress: (percent: number) => void }):
    Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise(resolve => {
        const child = spawn('tar', opts.totalBytes ? ['--checkpoint=1000', ...args] : args);
        let stdout = '', stderr = '', pending = '';
        const timer = setTimeout(() => child.kill('SIGKILL'), 30 * 60_000);

        child.stdout.on('data', (b: Buffer) => { stdout += b.toString(); });
        child.stderr.on('data', (b: Buffer) => {
            const lines = (pending + b.toString()).split('\n');
            pending = lines.pop() ?? '';
            for (const line of lines) {
                const cp = line.match(/(?:Read|Write) checkpoint (\d+)/);
                if (cp && opts.totalBytes) opts.onProgress(Number(cp[1]) * 10240 / opts.totalBytes * 100);
                else if (line) stderr += line + '\n';
            }
        });

        if (opts.input) {
            const size = fs.statSync(opts.input).size || 1;
            let read = 0;
            const stream = fs.createReadStream(opts.input);
            stream.on('data', chunk => { read += chunk.length; opts.onProgress(read / size * 100); });
            stream.on('error', () => child.kill());
            child.stdin.on('error', () => { /* tar exited early; its exit code reports why */ });
            stream.pipe(child.stdin);
        } else {
            child.stdin.end();
        }

        child.on('error', e => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: e.message }); });
        child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr: stderr + pending }); });
    });
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

        res.json({ success: true, message: 'Restore complete', entries: entries.length });
    } catch (e: any) {
        if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
        res.status(500).json({ error: e.message });
    }
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
