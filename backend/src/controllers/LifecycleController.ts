import { Request, Response } from 'express';
import { prisma } from '../index';
import { ServerStatus } from '@ramscraft/shared';
import { processService } from '../services/ProcessService';
import { providerRegistry } from '../providers/ProviderRegistry';
import { selectJavaRuntime } from '../utils/java';
import { serverRoot } from '../utils/paths';
import fs from 'fs';
import path from 'path';

export class LifecycleController {
    static async start(req: Request, res: Response) {
        try {
            const server = await prisma.server.findUnique({ 
                where: { id: req.params.id }, 
                include: { software: true, javaRuntime: true } 
            });
            if (!server) return res.status(404).json({ error: 'Server not found' });
            
            if (server.status !== ServerStatus.OFFLINE && server.status !== ServerStatus.CRASHED) {
                return res.status(400).json({ error: 'Server must be OFFLINE to start.' });
            }

            const serverDir = serverRoot(server.directoryName);
            if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });

            // EULA check
            const eulaPath = path.join(serverDir, 'eula.txt');
            if (fs.existsSync(eulaPath)) {
                const eulaContent = fs.readFileSync(eulaPath, 'utf8');
                if (!eulaContent.includes('eula=true')) {
                    await prisma.server.update({ where: { id: server.id }, data: { status: ServerStatus.EULA_PENDING } });
                    return res.status(403).json({ error: 'EULA must be accepted.', status: ServerStatus.EULA_PENDING });
                }
            } else {
                await prisma.server.update({ where: { id: server.id }, data: { status: ServerStatus.EULA_PENDING } });
                return res.status(403).json({ error: 'EULA not found. Accept it to continue.', status: ServerStatus.EULA_PENDING });
            }

            if (!server.software) return res.status(400).json({ error: 'No software installed.' });

            const jarPath = path.join(serverDir, 'server.jar');
            if (!fs.existsSync(jarPath)) {
                return res.status(400).json({ error: 'Server jar is missing. Re-install the software before starting.' });
            }

            const provider = providerRegistry.get(server.software.provider);
            const args = provider.getStartupArgs(server.minRamMb, server.maxRamMb, 'server.jar');

            // Select a compatible, installed Java runtime (honours min AND max range).
            let selected;
            try {
                selected = await selectJavaRuntime(server.software.mcVersion, server.javaRuntimeId);
            } catch (e: any) {
                return res.status(400).json({ error: e.message });
            }

            await processService.startServer(server.id, selected.path, args, serverDir);
            res.json({ success: true, status: ServerStatus.STARTING });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    static async stop(req: Request, res: Response) {
        try {
            const server = await prisma.server.findUnique({ where: { id: req.params.id } });
            if (!server) return res.status(404).json({ error: 'Server not found' });
            
            if (server.status !== ServerStatus.ONLINE && server.status !== ServerStatus.STARTING) {
                return res.status(400).json({ error: 'Server is not running.' });
            }

            await processService.stopServer(server.id, 30000); // 30s timeout
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    static async kill(req: Request, res: Response) {
        await processService.forceKill(req.params.id);
        res.json({ success: true });
    }

    static async acceptEula(req: Request, res: Response) {
        try {
            const server = await prisma.server.findUnique({ where: { id: req.params.id } });
            if (!server) return res.status(404).json({ error: 'Server not found' });

            const eulaPath = path.join(process.cwd(), '..', 'servers', server.directoryName, 'eula.txt');
            fs.mkdirSync(path.dirname(eulaPath), { recursive: true });
            fs.writeFileSync(eulaPath, 'eula=true\n');

            await prisma.server.update({ where: { id: server.id }, data: { eulaAccepted: true, status: ServerStatus.OFFLINE } });
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
}
