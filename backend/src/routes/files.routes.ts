import { Router } from 'express';
import { prisma } from '../index';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { serverRoot, resolveWithinServer, PathEscapeError } from '../utils/paths';

const router = Router();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 1024 * 1024 * 1024 } });

// Resolve + validate the requested path against the server root. All traversal,
// absolute-path, sibling-prefix and symlink escapes are rejected here.
const resolvePath = async (req: any, res: any, next: any) => {
    try {
        const server = await prisma.server.findUnique({ where: { id: req.params.id } });
        if (!server) return res.status(404).json({ error: 'Server not found' });
        const requested = req.query.path ? String(req.query.path) : '/';
        req.directoryName = server.directoryName;
        req.serverDir = serverRoot(server.directoryName);
        req.baseRel = requested.replace(/^[/\\]+/, '');
        req.targetPath = resolveWithinServer(server.directoryName, requested);
        req.serverStatus = server.status;
        next();
    } catch (e: any) {
        if (e instanceof PathEscapeError) return res.status(403).json({ error: 'Access denied' });
        return res.status(500).json({ error: e.message });
    }
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
                return { name: file, isDirectory: fileStats.isDirectory(), size: fileStats.size, modifiedAt: fileStats.mtime };
            });
            items.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
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
        if (!fs.existsSync(req.targetPath)) fs.mkdirSync(req.targetPath, { recursive: true });
        for (const file of req.files) {
            const idx = req.files.indexOf(file);
            const rel = req.body.paths ? (Array.isArray(req.body.paths) ? req.body.paths[idx] : req.body.paths) : file.originalname;
            let destPath: string;
            try {
                destPath = resolveWithinServer(req.directoryName, path.posix.join(req.baseRel, String(rel)));
            } catch {
                fs.unlinkSync(file.path); // reject unsafe destination
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
        // Validate every entry resolves inside the server root before extracting anything.
        for (const entry of zip.getEntries()) {
            try {
                resolveWithinServer(req.directoryName, path.posix.join(req.baseRel, entry.entryName));
            } catch {
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
        if (!fs.existsSync(req.targetPath)) fs.mkdirSync(req.targetPath, { recursive: true });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/:id/files/move', resolvePath, (req: any, res: any) => {
    try {
        const { targetPath } = req.body;
        let destFullPath: string;
        try {
            destFullPath = resolveWithinServer(req.directoryName, String(targetPath));
        } catch {
            return res.status(403).json({ error: 'Access denied' });
        }
        if (!fs.existsSync(req.targetPath)) return res.status(404).json({ error: 'Source not found' });
        fs.mkdirSync(path.dirname(destFullPath), { recursive: true });
        fs.renameSync(req.targetPath, destFullPath);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/:id/files/content', resolvePath, (req: any, res: any) => {
    try {
        if (!fs.existsSync(req.targetPath)) return res.status(404).json({ error: 'File not found' });
        if (fs.statSync(req.targetPath).isDirectory()) return res.status(400).json({ error: 'Not a file' });
        const content = fs.readFileSync(req.targetPath, 'utf8');
        res.json({ content });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/:id/files/content', resolvePath, (req: any, res: any) => {
    try {
        const { content } = req.body;
        if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });
        fs.writeFileSync(req.targetPath, content, 'utf8');
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/:id/files', resolvePath, (req: any, res: any) => {
    try {
        // Never allow deleting the server root itself.
        if (path.resolve(req.targetPath) === path.resolve(req.serverDir)) {
            return res.status(400).json({ error: 'Cannot delete the server root' });
        }
        if (fs.existsSync(req.targetPath)) fs.rmSync(req.targetPath, { recursive: true, force: true });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
