import { Router } from 'express';
import { prisma } from '../index';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { ServerStatus } from '@ramscraft/shared';
import { serverRoot, isInside } from '../utils/paths';
import { run } from '../utils/exec';
import { selectJavaRuntime } from '../utils/java';
import { providerRegistry } from '../providers/ProviderRegistry';
import { processService } from '../services/ProcessService';
import { launchFilePresent, readLaunchConfig } from '../providers/launch';
import { isInstalling } from '../services/SoftwareInstallService';

const router = Router();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 1024 * 1024 * 1024 } });

const resolveServer = async (req: any, res: any, next: any) => {
    const server = await prisma.server.findUnique({ where: { id: req.params.id }, include: { software: true } });
    if (!server) return res.status(404).json({ error: 'Server not found' });
    req.server = server;
    req.serverDir = serverRoot(server.directoryName);
    next();
};

// A folder is a world iff it directly contains level.dat.
function isWorld(dir: string): boolean {
    try { return fs.existsSync(path.join(dir, 'level.dat')); } catch { return false; }
}

// Size via `du` in a child process: a recursive synchronous walk blocks the event
// loop for seconds on a large world.
async function getDirectorySize(dirPath: string): Promise<number> {
    try {
        const { stdout, code } = await run('du', ['-sb', dirPath], { timeoutMs: 30_000 });
        if (code !== 0) return 0;
        return parseInt(stdout.split(/\s+/)[0], 10) || 0;
    } catch {
        return 0;
    }
}

interface AsideMove { original: string; aside: string; }

/**
 * Move existing worlds aside instead of deleting them. The single-world paradigm is
 * preserved (they are discarded once the replacement is verified), but a failed or
 * timed-out generation/import can no longer destroy the only copy of a world.
 * Aside directories are dot-prefixed so they are not listed as worlds.
 */
function moveWorldsAside(serverDir: string): AsideMove[] {
    const moved: AsideMove[] = [];
    if (!fs.existsSync(serverDir)) return moved;
    const stamp = Date.now();
    for (const item of fs.readdirSync(serverDir)) {
        if (item.startsWith('.')) continue;
        const itemPath = path.join(serverDir, item);
        try {
            if (fs.statSync(itemPath).isDirectory() && isWorld(itemPath)) {
                const aside = path.join(serverDir, `.${item}_replaced_${stamp}`);
                fs.renameSync(itemPath, aside);
                moved.push({ original: itemPath, aside });
            }
        } catch { /* skip unreadable entries */ }
    }
    return moved;
}

/** Commit the replacement: permanently remove the set-aside worlds. */
function discardAside(moved: AsideMove[]) {
    for (const m of moved) {
        try { fs.rmSync(m.aside, { recursive: true, force: true }); } catch { /* ignore */ }
    }
}

/** Roll back: put the set-aside worlds back where they were. */
function restoreAside(moved: AsideMove[]) {
    for (const m of moved) {
        try {
            if (fs.existsSync(m.aside) && !fs.existsSync(m.original)) fs.renameSync(m.aside, m.original);
        } catch { /* ignore */ }
    }
}

/** Read the current level-name so it can be rolled back if an operation fails. */
function readLevelName(propPath: string): string | null {
    if (!fs.existsSync(propPath)) return null;
    const line = fs.readFileSync(propPath, 'utf8').split('\n').find(l => l.startsWith('level-name='));
    return line ? line.slice('level-name='.length) : null;
}

function writeLevelName(propPath: string, worldName: string) {
    let props = fs.existsSync(propPath) ? fs.readFileSync(propPath, 'utf8').split('\n') : [];
    const idx = props.findIndex(l => l.startsWith('level-name='));
    if (idx >= 0) props[idx] = `level-name=${worldName}`; else props.push(`level-name=${worldName}`);
    fs.writeFileSync(propPath, props.join('\n'), 'utf8');
}

router.get('/:id/worlds', resolveServer, async (req: any, res: any) => {
    try {
        if (!fs.existsSync(req.serverDir)) return res.json([]);
        const worlds: any[] = [];
        for (const item of fs.readdirSync(req.serverDir)) {
            if (item.startsWith('.')) continue; // hide set-aside/internal dirs
            const itemPath = path.join(req.serverDir, item);
            if (fs.statSync(itemPath).isDirectory() && isWorld(itemPath)) {
                worlds.push({
                    name: item,
                    modifiedAt: fs.statSync(itemPath).mtime,
                    size: await getDirectorySize(itemPath)
                });
            }
        }
        res.json(worlds);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/:id/worlds/generate', resolveServer, async (req: any, res: any) => {
    const server = req.server;
    const serverDir = req.serverDir;
    try {
        if (server.status !== ServerStatus.OFFLINE && server.status !== ServerStatus.CRASHED) {
            return res.status(400).json({ error: 'Server must be offline to generate a new world.' });
        }
        if (await processService.hasSession(server.id)) {
            return res.status(400).json({ error: 'Server process is still running.' });
        }
        const worldName = String(req.body.worldName || 'world').trim();
        if (!/^[A-Za-z0-9_.-]{1,64}$/.test(worldName)) {
            return res.status(400).json({ error: 'Invalid world name (use letters, numbers, _ . - up to 64 chars)' });
        }
        if (!server.software) return res.status(400).json({ error: 'Install server software before generating a world.' });
        if (isInstalling(server.id)) return res.status(409).json({ error: 'Software is being installed. Try again when it finishes.' });
        const launch = readLaunchConfig(serverDir);
        if (!launchFilePresent(serverDir, launch)) return res.status(400).json({ error: 'Server software files are missing. Re-install the software first.' });

        const eulaPath = path.join(serverDir, 'eula.txt');
        if (!fs.existsSync(eulaPath) || !fs.readFileSync(eulaPath, 'utf8').includes('eula=true')) {
            return res.status(400).json({ error: 'Accept the EULA before generating a world.' });
        }

        // Single-world paradigm: existing worlds are replaced. They are moved aside
        // first and only deleted once the new world is verified, so a failed or
        // timed-out generation cannot destroy the only copy.
        const propPath = path.join(serverDir, 'server.properties');
        const previousLevelName = readLevelName(propPath);
        const moved = moveWorldsAside(serverDir);
        const worldPath = path.join(serverDir, worldName);

        const rollback = () => {
            try { if (fs.existsSync(worldPath)) fs.rmSync(worldPath, { recursive: true, force: true }); } catch { /* ignore */ }
            restoreAside(moved);
            if (previousLevelName !== null) writeLevelName(propPath, previousLevelName);
        };

        writeLevelName(propPath, worldName);

        // Run the server headlessly until it finishes generating, then stop it.
        const java = await selectJavaRuntime(server.software.mcVersion, server.javaRuntimeId);
        const args = providerRegistry.get(server.software.provider).getStartupArgs(server.minRamMb, server.maxRamMb, launch);

        const generated = await runHeadlessGeneration(java.path, args, serverDir, 180_000);
        if (!generated) {
            rollback();
            return res.status(500).json({ error: 'World generation timed out or the server did not finish starting. The previous world was restored.' });
        }
        if (!isWorld(worldPath)) {
            rollback();
            return res.status(500).json({ error: 'Generation completed but no level.dat was produced. The previous world was restored.' });
        }

        // Verified: now discard the replaced worlds.
        discardAside(moved);
        res.json({ success: true, backupCreated: false, world: worldName });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/:id/worlds/import', resolveServer, upload.single('file'), async (req: any, res: any) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        // Never replace the world of a running server (generate already guards this).
        const server = req.server;
        if (server.status !== ServerStatus.OFFLINE && server.status !== ServerStatus.CRASHED) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Server must be offline to import a world.' });
        }
        if (await processService.hasSession(server.id)) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Server process is still running.' });
        }

        const worldName = String(req.body.worldName || 'world').trim();
        if (!/^[A-Za-z0-9_.-]{1,64}$/.test(worldName)) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Invalid world name' });
        }

        const serverDir = req.serverDir;
        const tmpExtractDir = path.join(serverDir, `._tmp_extract_${Date.now()}`);
        fs.mkdirSync(tmpExtractDir, { recursive: true });

        const zip = new AdmZip(req.file.path);
        // Validate every entry resolves inside the extraction dir before writing any
        // of them (same boundary the file manager enforces; do not rely on the zip
        // library's own sanitisation).
        for (const entry of zip.getEntries()) {
            const name = entry.entryName.replace(/\\/g, '/');
            const resolved = path.resolve(tmpExtractDir, name);
            if (name.startsWith('/') || name.split('/').some(seg => seg === '..') || !isInside(tmpExtractDir, resolved)) {
                fs.rmSync(tmpExtractDir, { recursive: true, force: true });
                fs.unlinkSync(req.file.path);
                return res.status(403).json({ error: 'Zip contains unsafe paths' });
            }
        }
        zip.extractAllTo(tmpExtractDir, true);
        fs.unlinkSync(req.file.path);

        // Find the folder containing level.dat
        let worldRoot = '';
        const searchForLevelDat = (currentPath: string) => {
            if (fs.existsSync(path.join(currentPath, 'level.dat'))) {
                worldRoot = currentPath;
                return true;
            }
            const items = fs.readdirSync(currentPath);
            for (const item of items) {
                const itemPath = path.join(currentPath, item);
                if (fs.statSync(itemPath).isDirectory()) {
                    if (searchForLevelDat(itemPath)) return true;
                }
            }
            return false;
        };

        if (!searchForLevelDat(tmpExtractDir)) {
            fs.rmSync(tmpExtractDir, { recursive: true, force: true });
            return res.status(400).json({ error: 'Uploaded zip does not contain a valid Minecraft world (missing level.dat)' });
        }

        // The discovered world root must still be inside the extraction dir (guards
        // against a symlinked directory leading the search outside the server).
        if (!isInside(tmpExtractDir, fs.realpathSync(worldRoot))) {
            fs.rmSync(tmpExtractDir, { recursive: true, force: true });
            return res.status(403).json({ error: 'Zip contains unsafe paths' });
        }

        // Replace existing worlds, keeping them until the import is in place.
        const propPath = path.join(serverDir, 'server.properties');
        const previousLevelName = readLevelName(propPath);
        const moved = moveWorldsAside(serverDir);
        const finalWorldPath = path.join(serverDir, worldName);

        try {
            fs.renameSync(worldRoot, finalWorldPath);
        } catch (swapErr) {
            restoreAside(moved);
            if (previousLevelName !== null) writeLevelName(propPath, previousLevelName);
            fs.rmSync(tmpExtractDir, { recursive: true, force: true });
            throw swapErr;
        }

        if (fs.existsSync(tmpExtractDir)) {
            fs.rmSync(tmpExtractDir, { recursive: true, force: true });
        }

        writeLevelName(propPath, worldName);
        discardAside(moved);

        res.json({ success: true, world: worldName });
    } catch (e: any) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: e.message });
    }
});

function runHeadlessGeneration(javaPath: string, args: string[], cwd: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
        const child = spawn(javaPath, args, { cwd });
        let done = false;
        let settled = false;
        const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(ok);
        };
        const timer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch { /* ignore */ }
            finish(false);
        }, timeoutMs);

        child.stdout.on('data', (buf: Buffer) => {
            const text = buf.toString();
            if (!done && /\bDone\s*\(/.test(text)) {
                done = true;
                try { child.stdin.write('stop\n'); } catch { /* ignore */ }
            }
        });
        child.on('error', () => finish(false));
        child.on('close', () => finish(done));
    });
}

export default router;
