import { Request, Response } from 'express';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { prisma } from '../index';
import { ServerStatus } from '@ramscraft/shared';
import { processService } from '../services/ProcessService';
import { serverRoot, slugifyServerName } from '../utils/paths';

const HOST_MEM_MB = Math.floor(os.totalmem() / 1024 / 1024);

function validateRam(minRamMb: any, maxRamMb: any): string | null {
    if (!Number.isInteger(minRamMb) || !Number.isInteger(maxRamMb)) return 'RAM values must be integers (MB)';
    if (minRamMb < 512) return 'Minimum RAM must be at least 512 MB';
    if (maxRamMb < minRamMb) return 'Maximum RAM must be >= minimum RAM';
    if (maxRamMb > HOST_MEM_MB) return `Maximum RAM (${maxRamMb} MB) exceeds host memory (${HOST_MEM_MB} MB)`;
    return null;
}

function validatePort(port: any): string | null {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return 'Valid port is required (1024-65535)';
    return null;
}

export class ServerController {

    static async listServers(req: Request, res: Response) {
        const servers = await prisma.server.findMany({ include: { software: true, javaRuntime: true } });
        res.json(servers);
    }

    static async getServer(req: Request, res: Response) {
        const server = await prisma.server.findUnique({ where: { id: req.params.id }, include: { software: true, javaRuntime: true } });
        if (!server) return res.status(404).json({ error: 'Server not found' });
        res.json(server);
    }

    static async createServer(req: Request, res: Response) {
        try {
            const { name, port, minRamMb, maxRamMb } = req.body;

            if (!name || String(name).trim() === '') return res.status(400).json({ error: 'Name is required' });
            const portErr = validatePort(port);
            if (portErr) return res.status(400).json({ error: portErr });
            const ramErr = validateRam(minRamMb, maxRamMb);
            if (ramErr) return res.status(400).json({ error: ramErr });

            // Generate a unique directory slug (avoids collisions from names that
            // differ only in punctuation/case, e.g. "test " vs "test").
            const base = slugifyServerName(String(name));
            let directoryName = base;
            let n = 1;
            while (
                fs.existsSync(path.join(serverRoot(directoryName))) ||
                await prisma.server.findUnique({ where: { directoryName } })
            ) {
                directoryName = `${base}-${n++}`;
            }

            const serverDir = serverRoot(directoryName);
            if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });
            fs.writeFileSync(path.join(serverDir, 'server.properties'), `server-port=${port}\n`);

            const newServer = await prisma.server.create({
                data: { name, directoryName, port, minRamMb, maxRamMb, status: ServerStatus.OFFLINE }
            });
            res.status(201).json(newServer);
        } catch (error: any) {
            if (error.code === 'P2002') {
                const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : String(error.meta?.target || '');
                if (target.includes('port')) return res.status(409).json({ error: 'A server with this port already exists' });
                if (target.includes('name')) return res.status(409).json({ error: 'A server with this name already exists' });
                return res.status(409).json({ error: 'A server with these details already exists' });
            }
            res.status(500).json({ error: 'Failed to create server', details: error.message });
        }
    }

    static async updateServer(req: Request, res: Response) {
        try {
            const existing = await prisma.server.findUnique({ where: { id: req.params.id } });
            if (!existing) return res.status(404).json({ error: 'Server not found' });

            const { name, port, minRamMb, maxRamMb, javaRuntimeId, publicAddress } = req.body;
            const data: any = {};

            if (name !== undefined) {
                if (String(name).trim() === '') return res.status(400).json({ error: 'Name cannot be empty' });
                data.name = name;
            }
            if (port !== undefined) {
                const portErr = validatePort(port);
                if (portErr) return res.status(400).json({ error: portErr });
                data.port = port;
            }
            if (minRamMb !== undefined || maxRamMb !== undefined) {
                const min = minRamMb ?? existing.minRamMb;
                const max = maxRamMb ?? existing.maxRamMb;
                const ramErr = validateRam(min, max);
                if (ramErr) return res.status(400).json({ error: ramErr });
                data.minRamMb = min;
                data.maxRamMb = max;
            }
            if (javaRuntimeId !== undefined) data.javaRuntimeId = javaRuntimeId || null;
            if (publicAddress !== undefined) data.publicAddress = publicAddress || null;

            const server = await prisma.server.update({ where: { id: req.params.id }, data });
            res.json(server);
        } catch (error: any) {
            if (error.code === 'P2002') return res.status(409).json({ error: 'Name or port already in use' });
            res.status(400).json({ error: 'Failed to update server' });
        }
    }

    static async deleteServer(req: Request, res: Response) {
        try {
            const server = await prisma.server.findUnique({ where: { id: req.params.id } });
            if (!server) return res.status(404).json({ error: 'Server not found' });

            // Never delete a running server; require it be stopped first.
            if (server.status !== ServerStatus.OFFLINE && server.status !== ServerStatus.CRASHED) {
                return res.status(400).json({ error: 'Stop the server before deleting it.' });
            }
            if (await processService.hasSession(server.id)) {
                return res.status(400).json({ error: 'Server process is still running; stop it before deleting.' });
            }

            // Clean up managed files: server directory, its backups, and the console log.
            try {
                const dir = serverRoot(server.directoryName);
                if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
                const backupDir = dir + '_backups';
                if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
                const logPath = processService.getLogFilePath(server.id);
                if (fs.existsSync(logPath)) fs.rmSync(logPath, { force: true });
            } catch (fsErr) {
                console.error('[Delete] filesystem cleanup error', fsErr);
            }

            // Cascade removes Software + Backup rows (schema onDelete: Cascade).
            await prisma.server.delete({ where: { id: server.id } });
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to delete server' });
        }
    }
}
