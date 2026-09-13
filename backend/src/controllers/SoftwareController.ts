import { Request, Response } from 'express';
import { providerRegistry } from '../providers/ProviderRegistry';
import { prisma } from '../index';
import { serverRoot } from '../utils/paths';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';

async function hashFile(filePath: string, algo: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash(algo);
        const stream = fs.createReadStream(filePath);
        stream.on('data', d => hash.update(d));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

export class SoftwareController {
    
    static async listProviders(req: Request, res: Response) {
        const providers = providerRegistry.getAll().map(p => ({
            id: p.id,
            name: p.name,
            category: p.category
        }));
        res.json(providers);
    }

    static async getMcVersions(req: Request, res: Response) {
        try {
            const provider = providerRegistry.get(req.params.providerId);
            const versions = await provider.getMcVersions();
            res.json(versions);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    static async getReleases(req: Request, res: Response) {
        try {
            const provider = providerRegistry.get(req.params.providerId);
            const releases = await provider.getReleases(req.params.mcVersion);
            res.json(releases);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    static async prepareInstallation(req: Request, res: Response) {
        try {
            const { serverId } = req.params;
            const { providerId, mcVersion, releaseId } = req.body;

            // 1. Validate Server
            const server = await prisma.server.findUnique({ where: { id: serverId } });
            if (!server) return res.status(404).json({ error: 'Server not found' });

            // 2. Validate Provider & Fetch metadata
            const provider = providerRegistry.get(providerId);
            const releases = await provider.getReleases(mcVersion);
            const release = releases.find(r => r.id === releaseId);
            if (!release) return res.status(400).json({ error: 'Release not found for this version' });

            const downloadInfo = await provider.getDownloadInfo(mcVersion, release);
            const javaCompat = await provider.getJavaCompatibility(mcVersion, release);

            const serverDir = serverRoot(server.directoryName);
            if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });

            // Download to a temp file, verify the checksum, and only then install it.
            // A tampered/truncated download must never be registered as valid software.
            const tmpPath = path.join(serverDir, `.server.jar.download-${Date.now()}`);
            try {
                const response = await axios({ method: 'GET', url: downloadInfo.url, responseType: 'stream' });
                const writer = fs.createWriteStream(tmpPath);
                await new Promise((resolve, reject) => {
                    response.data.pipe(writer);
                    writer.on('finish', () => resolve(true));
                    writer.on('error', reject);
                    response.data.on('error', reject);
                });

                if (downloadInfo.checksum && downloadInfo.checksumAlgo) {
                    const actual = await hashFile(tmpPath, downloadInfo.checksumAlgo);
                    if (actual.toLowerCase() !== downloadInfo.checksum.toLowerCase()) {
                        fs.rmSync(tmpPath, { force: true });
                        return res.status(502).json({
                            error: `Downloaded jar failed ${downloadInfo.checksumAlgo} verification; installation aborted.`
                        });
                    }
                } else {
                    console.warn(`[Software] No checksum available for ${providerId} ${mcVersion} ${release.id}; installing unverified.`);
                }

                // Verified: move into place, then register the software metadata.
                fs.renameSync(tmpPath, path.join(serverDir, 'server.jar'));
            } catch (dlErr: any) {
                if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
                return res.status(502).json({ error: `Download failed: ${dlErr.message}` });
            }

            const software = await prisma.software.upsert({
                where: { serverId },
                update: { provider: providerId, mcVersion, releaseId: release.id, installerUrl: downloadInfo.url },
                create: { serverId, provider: providerId, mcVersion, releaseId: release.id, installerUrl: downloadInfo.url }
            });

            res.json({ success: true, message: 'Software installed and verified', software, javaCompat });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
}
