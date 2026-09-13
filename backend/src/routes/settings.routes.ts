import { Router } from 'express';
import { prisma } from '../index';
import fs from 'fs';
import path from 'path';
import { processService } from '../services/ProcessService';

const router = Router();

router.get('/:id/settings', async (req, res) => {
    try {
        const server = await prisma.server.findUnique({where:{id: req.params.id}}); if(!server) return res.status(404).json({error:'Not found'}); const serverDir = require('path').join(process.cwd(), '..', 'servers', server.directoryName);
        const propPath = path.join(serverDir, 'server.properties');
        if (!fs.existsSync(propPath)) {
            return res.json({});
        }
        
        const content = fs.readFileSync(propPath, 'utf8');
        const props: Record<string, string> = {};
        content.split('\n').forEach(line => {
            line = line.trim();
            if (line && !line.startsWith('#')) {
                const parts = line.split('=');
                if (parts.length >= 2) {
                    const key = parts[0];
                    const val = parts.slice(1).join('=');
                    props[key] = val;
                }
            }
        });
        res.json(props);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.patch('/:id/settings', async (req, res) => {
    try {
        const updates = req.body;
        const server = await prisma.server.findUnique({where:{id: req.params.id}}); if(!server) return res.status(404).json({error:'Not found'}); const serverDir = require('path').join(process.cwd(), '..', 'servers', server.directoryName);
        const propPath = path.join(serverDir, 'server.properties');
        
        let lines: string[] = [];
        if (fs.existsSync(propPath)) {
            lines = fs.readFileSync(propPath, 'utf8').split('\n');
        }
        
        const existingKeys = new Set();
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line && !line.startsWith('#')) {
                const parts = line.split('=');
                if (parts.length >= 1) {
                    const key = parts[0];
                    existingKeys.add(key);
                    if (updates[key] !== undefined) {
                        lines[i] = `${key}=${updates[key]}`;
                    }
                }
            }
        }
        
        for (const [key, val] of Object.entries(updates)) {
            if (!existingKeys.has(key)) {
                lines.push(`${key}=${val}`);
            }
        }
        
        fs.writeFileSync(propPath, lines.join('\n'), 'utf8');
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
