import { Router } from 'express';
import { prisma } from '../index';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ServerStatus } from '@ramscraft/shared';
import { serverRoot } from '../utils/paths';
import { selectJavaRuntime } from '../utils/java';
import { providerRegistry } from '../providers/ProviderRegistry';
import { processService } from '../services/ProcessService';

const router = Router();

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

router.get('/:id/worlds', resolveServer, (req: any, res: any) => {
    try {
        if (!fs.existsSync(req.serverDir)) return res.json([]);
        const worlds: any[] = [];
        for (const item of fs.readdirSync(req.serverDir)) {
            const itemPath = path.join(req.serverDir, item);
            if (fs.statSync(itemPath).isDirectory() && isWorld(itemPath)) {
                worlds.push({ name: item, modifiedAt: fs.statSync(itemPath).mtime });
            }
        }
        res.json(worlds);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Generate a new world using the real Minecraft server (headless), then verify it
 * actually produced a level.dat before reporting success. This is a bounded,
 * synchronous operation; the server must be OFFLINE.
 */
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
        const worldName = String(req.body.worldName || '').trim();
        if (!worldName || !/^[A-Za-z0-9_.-]{1,64}$/.test(worldName)) {
            return res.status(400).json({ error: 'Invalid world name (use letters, numbers, _ . - up to 64 chars)' });
        }
        if (!server.software) return res.status(400).json({ error: 'Install server software before generating a world.' });
        const jarPath = path.join(serverDir, 'server.jar');
        if (!fs.existsSync(jarPath)) return res.status(400).json({ error: 'Server jar is missing.' });

        // EULA must be accepted for the server to run and generate anything.
        const eulaPath = path.join(serverDir, 'eula.txt');
        if (!fs.existsSync(eulaPath) || !fs.readFileSync(eulaPath, 'utf8').includes('eula=true')) {
            return res.status(400).json({ error: 'Accept the EULA before generating a world.' });
        }

        const worldPath = path.join(serverDir, worldName);
        let backupCreated = false;
        if (fs.existsSync(worldPath)) {
            fs.renameSync(worldPath, `${worldPath}_backup_${Date.now()}`);
            backupCreated = true;
        }

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

        // Verify the world actually exists before reporting success.
        if (!isWorld(worldPath)) {
            return res.status(500).json({ error: 'Generation completed but no level.dat was produced.' });
        }
        res.json({ success: true, backupCreated, world: worldName });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/** Spawn the MC server, wait for "Done", issue "stop", and wait for a clean exit. */
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
