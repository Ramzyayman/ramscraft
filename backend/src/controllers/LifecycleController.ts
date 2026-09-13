import { Request, Response } from 'express';
import { prisma } from '../index';
import { ServerStatus } from '@ramscraft/shared';
import { processService } from '../services/ProcessService';
import { providerRegistry } from '../providers/ProviderRegistry';
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

            const serverDir = path.join(process.cwd(), '..', 'servers', server.directoryName);
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
            
            const provider = providerRegistry.get(server.software.provider);
            const jarName = 'server.jar'; // Assume downloaded jar is named this for now
            const args = provider.getStartupArgs(server.minRamMb, server.maxRamMb, jarName);
            
            // Java Compatibility Check & Auto-selection
            const javaCompat = await provider.getJavaCompatibility(server.software.mcVersion, { id: server.software.releaseId, displayVersion: '', isStable: true });
            let javaExecutable = 'java';
            
            let selectedRuntime = server.javaRuntime;
            if (selectedRuntime && selectedRuntime.majorVersion < javaCompat.minVersion) {
                selectedRuntime = null; // Configured runtime is invalid, we must find a valid one
            }

            if (!selectedRuntime) {
                // Auto-detect a compatible runtime
                const compatibleRuntimes = await prisma.javaRuntime.findMany({
                    where: { majorVersion: { gte: javaCompat.minVersion } },
                    orderBy: { majorVersion: 'asc' }
                });
                if (compatibleRuntimes.length > 0) {
                    selectedRuntime = compatibleRuntimes[0];
                }
            }

            if (!selectedRuntime) {
                return res.status(400).json({ 
                    error: `Minecraft ${server.software.mcVersion} requires Java ${javaCompat.minVersion} or newer, but it is not installed on the system. Please install it and restart the RamsCraft backend to detect it.` 
                });
            }

            javaExecutable = selectedRuntime.path;
            const cmd = `${javaExecutable} ${args.join(' ')}`;

            await processService.startServer(server.id, cmd, serverDir);
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
