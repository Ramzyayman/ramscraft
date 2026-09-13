import { Router } from 'express';
import { prisma } from '../index';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import AdmZip from 'adm-zip';

const router = Router();

const upload = multer({ dest: 'uploads/' });

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
            if (req.query.action === 'download') {
                const zip = new AdmZip();
                zip.addLocalFolder(req.targetPath);
                const zipBuffer = zip.toBuffer();
                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', `attachment; filename="${path.basename(req.targetPath) || 'archive'}.zip"`);
                return res.send(zipBuffer);
            }

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

router.post('/:id/files/upload', resolvePath, upload.array('files'), (req: any, res: any) => {
    try {
        if (!fs.existsSync(req.targetPath)) {
            fs.mkdirSync(req.targetPath, { recursive: true });
        }
        for (const file of req.files) {
            // req.body.paths might contain relative paths if uploading a folder
            const relativePath = req.body.paths ? (Array.isArray(req.body.paths) ? req.body.paths[req.files.indexOf(file)] : req.body.paths) : file.originalname;
            const destPath = path.join(req.targetPath, relativePath);
            
            if (!destPath.startsWith(req.serverDir)) {
                fs.unlinkSync(file.path);
                continue;
            }

            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.renameSync(file.path, destPath);
        }
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/:id/files/extract', resolvePath, upload.single('file'), (req: any, res: any) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        
        const zip = new AdmZip(req.file.path);
        const zipEntries = zip.getEntries();
        
        // Validate all entries before extraction
        for (const entry of zipEntries) {
            const entryPath = path.normalize(path.join(req.targetPath, entry.entryName));
            if (!entryPath.startsWith(req.targetPath)) {
                fs.unlinkSync(req.file.path);
                return res.status(403).json({ error: 'Zip contains unsafe paths outside target directory' });
            }
        }
        
        zip.extractAllTo(req.targetPath, true);
        fs.unlinkSync(req.file.path);
        res.json({ success: true });
    } catch (e: any) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: e.message });
    }
});

router.post('/:id/files/folder', resolvePath, (req: any, res: any) => {
    try {
        if (!fs.existsSync(req.targetPath)) {
            fs.mkdirSync(req.targetPath, { recursive: true });
        }
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/:id/files/move', resolvePath, (req: any, res: any) => {
    try {
        const { targetPath } = req.body; // absolute relative to root, handled by frontend
        const destFullPath = path.normalize(path.join(req.serverDir, targetPath));
        if (!destFullPath.startsWith(req.serverDir)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        fs.renameSync(req.targetPath, destFullPath);
        res.json({ success: true });
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
