import { Router } from 'express';
import { prisma } from '../index';
import fs from 'fs';
import path from 'path';
import { processService } from '../services/ProcessService';

const router = Router();

// Middleware to resolve and validate paths
const resolvePath = async (req: any, res: any, next: any) => {
    const server = await prisma.server.findUnique({ where: { id: req.params.id } });
    if (!server) return res.status(404).json({ error: 'Server not found' });
    
    const serverDir = require('path').join(process.cwd(), '..', 'servers', server.directoryName);
    const requestedPath = req.query.path ? String(req.query.path) : '/';
    
    // Prevent directory traversal
    const fullPath = path.normalize(path.join(serverDir, requestedPath));
    if (!fullPath.startsWith(serverDir)) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    req.serverDir = serverDir;
    req.targetPath = fullPath;
    req.serverStatus = server.status;
    next();
};

router.get('/:id/files', resolvePath, (req: any, res: any) => {
    try {
        if (!fs.existsSync(req.targetPath)) return res.status(404).json({ error: 'Path not found' });
        
        const stats = fs.statSync(req.targetPath);
        if (stats.isDirectory()) {
            const items = fs.readdirSync(req.targetPath).map(file => {
                const filePath = path.join(req.targetPath, file);
                const fileStats = fs.statSync(filePath);
                return {
                    name: file,
                    isDirectory: fileStats.isDirectory(),
                    size: fileStats.size,
                    modifiedAt: fileStats.mtime
                };
            });
            // Sort dirs first
            items.sort((a, b) => {
                if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
                return a.isDirectory ? -1 : 1;
            });
            res.json(items);
        } else {
            res.download(req.targetPath);
        }
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/:id/files/content', resolvePath, (req: any, res: any) => {
    try {
        if (!fs.existsSync(req.targetPath)) return res.status(404).json({ error: 'File not found' });
        const content = fs.readFileSync(req.targetPath, 'utf8');
        res.json({ content });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/:id/files/content', resolvePath, (req: any, res: any) => {
    try {
        const { content } = req.body;
        fs.writeFileSync(req.targetPath, content, 'utf8');
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/:id/files', resolvePath, (req: any, res: any) => {
    try {
        if (fs.existsSync(req.targetPath)) {
            fs.rmSync(req.targetPath, { recursive: true, force: true });
        }
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
