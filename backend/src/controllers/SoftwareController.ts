import { Request, Response } from 'express';
import { providerRegistry } from '../providers/ProviderRegistry';
import { prisma } from '../index';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

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

            // 3. Upsert Software relation (Software installation metadata model/preparation)
            const software = await prisma.software.upsert({
                where: { serverId },
                update: {
                    provider: providerId,
                    mcVersion: mcVersion,
                    releaseId: release.id,
                    installerUrl: downloadInfo.url
                },
                create: {
                    serverId,
                    provider: providerId,
                    mcVersion: mcVersion,
                    releaseId: release.id,
                    installerUrl: downloadInfo.url
                }
            });

            // Actually download the JAR so the server can start
            const serverDir = path.join(process.cwd(), '..', 'servers', server.directoryName);
            if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });
            
            // Download jar
            const response = await axios({
                method: 'GET',
                url: downloadInfo.url,
                responseType: 'stream'
            });
            const writer = fs.createWriteStream(path.join(serverDir, 'server.jar'));
            response.data.pipe(writer);
            await new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(true));
                writer.on('error', reject);
            });
            res.json({ 
                success: true, 
                message: 'Software metadata prepared',
                software,
                javaCompat
            });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
}
