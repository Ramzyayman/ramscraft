
import { Router } from 'express';
import { prisma } from '../index';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { ServerStatus } from '@ramscraft/shared';

const router = Router();

router.get('/:id/backups', async (req, res) => {
    try {
        const backupDir = path.join(process.cwd(), '..', 'servers', req.params.id, '..', `${req.params.id}_backups`);
        if (!fs.existsSync(backupDir)) {
            return res.json([]);
        }
        const files = fs.readdirSync(backupDir)
            .filter(f => f.endsWith('.tar.gz'))
            .map(f => {
                const stat = fs.statSync(path.join(backupDir, f));
                return { name: f, size: stat.size, createdAt: stat.mtime };
            });
        res.json(files);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/:id/backups', async (req, res) => {
    try {
        const server = await prisma.server.findUnique({where:{id: req.params.id}}); 
        if(!server) return res.status(404).json({error:'Not found'}); 
        const serverDir = require('path').join(process.cwd(), '..', 'servers', server.directoryName);

        const backupDir = path.join(process.cwd(), '..', 'servers', req.params.id, '..', `${req.params.id}_backups`);
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        
        const backupName = `backup_${Date.now()}.tar.gz`;
        const targetPath = path.join(backupDir, backupName);
        
        exec(`tar -czf "${targetPath}" -C "${serverDir}" .`, (error) => {
            if (error) console.error('Backup failed:', error);
            else console.log('Backup finished:', backupName);
        });
        
        res.json({ success: true, message: 'Backup started in background' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/:id/backups/:file/restore', async (req, res) => {
    try {
        const server = await prisma.server.findUnique({ where: { id: req.params.id } });
        if(!server) return res.status(404).json({error:'Not found'}); 
        if (server.status !== ServerStatus.OFFLINE) {
            return res.status(400).json({ error: 'Server must be OFFLINE to restore a backup' });
        }
        
        const serverDir = require('path').join(process.cwd(), '..', 'servers', server.directoryName);
        const backupDir = path.join(process.cwd(), '..', 'servers', req.params.id, '..', `${req.params.id}_backups`);
        const targetFile = path.join(backupDir, req.params.file);
        
        if (!fs.existsSync(targetFile)) return res.status(404).json({ error: 'Backup not found' });
        
        // Clean current dir and extract
        exec(`rm -rf "${serverDir}"/* && tar -xzf "${targetFile}" -C "${serverDir}"`, (error) => {
            if (error) console.error('Restore failed:', error);
            else console.log('Restore finished:', req.params.file);
        });
        
        res.json({ success: true, message: 'Restore started in background' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
