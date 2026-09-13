import { Request, Response } from 'express';
import { prisma } from '../index';
import { ServerStatus } from '@ramscraft/shared';

export class ServerController {
    
    static async listServers(req: Request, res: Response) {
        const servers = await prisma.server.findMany({ include: { software: true } });
        res.json(servers);
    }

    static async getServer(req: Request, res: Response) {
        const server = await prisma.server.findUnique({ where: { id: req.params.id }, include: { software: true } });
        if (!server) return res.status(404).json({ error: 'Server not found' });
        res.json(server);
    }

    static async createServer(req: Request, res: Response) {
        try {
            const { name, port, minRamMb, maxRamMb } = req.body;
            
            // Basic Validation
            if (!name || name.trim() === '') return res.status(400).json({ error: 'Name is required' });
            if (!port || port < 1024 || port > 65535) return res.status(400).json({ error: 'Valid port is required (1024-65535)' });
            if (minRamMb < 512 || maxRamMb < minRamMb) return res.status(400).json({ error: 'Invalid RAM configuration' });

            const directoryName = name.toLowerCase().replace(/[^a-z0-9]/g, '-');

            // Create directory and properties
            const fs = require('fs');
            const path = require('path');
            const serverDir = path.join(process.cwd(), '..', 'servers', directoryName);
            if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });
            fs.writeFileSync(path.join(serverDir, 'server.properties'), `server-port=${port}\n`);
            
            const newServer = await prisma.server.create({
                data: {
                    name,
                    directoryName,
                    port,
                    minRamMb,
                    maxRamMb,
                    status: ServerStatus.OFFLINE
                }
            });
            res.status(201).json(newServer);
        } catch (error: any) {
            if (error.code === 'P2002') {
                return res.status(409).json({ error: 'A server with this name or port already exists' });
            }
            res.status(500).json({ error: 'Failed to create server', details: error.message });
        }
    }

    static async updateServer(req: Request, res: Response) {
        try {
            const { name, port, minRamMb, maxRamMb, javaRuntimeId, publicAddress } = req.body;
            const server = await prisma.server.update({
                where: { id: req.params.id },
                data: { name, port, minRamMb, maxRamMb, javaRuntimeId, publicAddress }
            });
            res.json(server);
        } catch (error) {
            res.status(400).json({ error: 'Failed to update server' });
        }
    }

    static async deleteServer(req: Request, res: Response) {
        try {
            await prisma.server.delete({ where: { id: req.params.id } });
            res.json({ success: true });
        } catch (error) {
            res.status(404).json({ error: 'Server not found or already deleted' });
        }
    }
}
