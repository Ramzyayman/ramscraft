import { Router } from 'express';
import { prisma } from '../index';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { ServerStatus } from '@ramscraft/shared';
import { serverRoot } from '../utils/paths';
import { selectJavaRuntime } from '../utils/java';
import { providerRegistry } from '../providers/ProviderRegistry';
import { processService } from '../services/ProcessService';

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

function getDirectorySize(dirPath: string): number {
    let size = 0;
    try {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stats = fs.statSync(filePath);
            if (stats.isDirectory()) {
                size += getDirectorySize(filePath);
            } else {
                size += stats.size;
            }
        }
    } catch { /* ignore */ }
    return size;
}

// Utility to wipe all existing worlds so only one active world ever remains
function wipeAllWorlds(serverDir: string) {
    if (!fs.existsSync(serverDir)) return;
    for (const item of fs.readdirSync(serverDir)) {
        const itemPath = path.join(serverDir, item);
        if (fs.statSync(itemPath).isDirectory() && isWorld(itemPath)) {
            fs.rmSync(itemPath, { recursive: true, force: true });
        }
    }
}

router.get('/:id/worlds', resolveServer, (req: any, res: any) => {
    try {
        if (!fs.existsSync(req.serverDir)) return res.json([]);
        const worlds: any[] = [];
        for (const item of fs.readdirSync(req.serverDir)) {
            const itemPath = path.join(req.serverDir, item);
            if (fs.statSync(itemPath).isDirectory() && isWorld(itemPath)) {
                worlds.push({ 
                    name: item, 
                    modifiedAt: fs.statSync(itemPath).mtime,
                    size: getDirectorySize(itemPath)
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
        const jarPath = path.join(serverDir, 'server.jar');
        if (!fs.existsSync(jarPath)) return res.status(400).json({ error: 'Server jar is missing.' });

        const eulaPath = path.join(serverDir, 'eula.txt');
        if (!fs.existsSync(eulaPath) || !fs.readFileSync(eulaPath, 'utf8').includes('eula=true')) {
            return res.status(400).json({ error: 'Accept the EULA before generating a world.' });
        }

        // The user specifically wants only a single world paradigm.
        // Generating a new world overrides and deletes any existing worlds.
        wipeAllWorlds(serverDir);

        // Point level-name at the new world.
        const propPath = path.join(serverDir, 'server.properties');
        let props = fs.existsSync(propPath) ? fs.readFileSync(propPath, 'utf8').split('\n') : [];
        const idx = props.findIndex(l => l.startsWith('level-name='));
        if (idx >= 0) props[idx] = `level-name=${worldName}`; else props.push(`level-name=${worldName}`);
        fs.writeFileSync(propPath, props.join('\n'), 'utf8');

        // Run the server headlessly until it finishes generating, then stop it.
        const java = await selectJavaRuntime(server.software.mcVersion, server.javaRuntimeId);
        const args = providerRegistry.get(server.software.provider).getStartupArgs(server.minRamMb, server.maxRamMb, 'server.jar');

        const generated = await runHeadlessGeneration(java.path, args, serverDir, 180_000);
        if (!generated) {
            return res.status(500).json({ error: 'World generation timed out or the server did not finish starting.' });
        }

        const worldPath = path.join(serverDir, worldName);
        if (!isWorld(worldPath)) {
            return res.status(500).json({ error: 'Generation completed but no level.dat was produced.' });
        }
        res.json({ success: true, backupCreated: false, world: worldName });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/:id/worlds/import', resolveServer, upload.single('file'), (req: any, res: any) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        
        const worldName = String(req.body.worldName || 'world').trim();
        if (!/^[A-Za-z0-9_.-]{1,64}$/.test(worldName)) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Invalid world name' });
        }

        const serverDir = req.serverDir;
        const tmpExtractDir = path.join(serverDir, `._tmp_extract_${Date.now()}`);
        fs.mkdirSync(tmpExtractDir, { recursive: true });

        const zip = new AdmZip(req.file.path);
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

        // Delete any existing worlds before finalizing the import
        wipeAllWorlds(serverDir);

        const finalWorldPath = path.join(serverDir, worldName);
        fs.renameSync(worldRoot, finalWorldPath);
        
        if (fs.existsSync(tmpExtractDir)) {
            fs.rmSync(tmpExtractDir, { recursive: true, force: true });
        }

        // Point level-name at the newly imported world.
        const propPath = path.join(serverDir, 'server.properties');
        let props = fs.existsSync(propPath) ? fs.readFileSync(propPath, 'utf8').split('\n') : [];
        const idx = props.findIndex(l => l.startsWith('level-name='));
        if (idx >= 0) props[idx] = `level-name=${worldName}`; else props.push(`level-name=${worldName}`);
        fs.writeFileSync(propPath, props.join('\n'), 'utf8');

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
