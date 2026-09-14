import { Request, Response } from 'express';
import { ServerStatus } from '@ramscraft/shared';
import { providerRegistry } from '../providers/ProviderRegistry';
import { prisma } from '../index';
import { processService } from '../services/ProcessService';
import { getInstallJob, startInstall } from '../services/SoftwareInstallService';
import { selectJavaRuntime } from '../utils/java';

export class SoftwareController {

    static async listProviders(req: Request, res: Response) {
        const providers = providerRegistry.getAll().map(p => ({
            id: p.id,
            name: p.name,
            category: p.category,
            labels: p.labels,
            note: p.note ?? null,
            searchable: !!p.searchable,
        }));
        res.json(providers);
    }

    static async getMcVersions(req: Request, res: Response) {
        try {
            const provider = providerRegistry.get(req.params.providerId);
            const query = typeof req.query.query === 'string' ? req.query.query.slice(0, 100) : '';
            const versions = await provider.getMcVersions(query);
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

    /**
     * Validate the request, then install in the background (downloads, installers and
     * Spigot builds can outlast any HTTP timeout). Progress arrives on the
     * `softwareProgress` socket event and from GET /:serverId/software/install.
     */
    static async prepareInstallation(req: Request, res: Response) {
        try {
            const { serverId } = req.params;
            const { providerId, mcVersion, releaseId } = req.body;
            if (typeof providerId !== 'string' || typeof mcVersion !== 'string' || typeof releaseId !== 'string') {
                return res.status(400).json({ error: 'providerId, mcVersion and releaseId are required' });
            }

            const server = await prisma.server.findUnique({ where: { id: serverId } });
            if (!server) return res.status(404).json({ error: 'Server not found' });

            const stopped = [ServerStatus.OFFLINE, ServerStatus.CRASHED, ServerStatus.EULA_PENDING].includes(server.status as ServerStatus);
            if (!stopped || await processService.hasSession(server.id)) {
                return res.status(409).json({ error: 'Stop the server before changing its software.' });
            }

            let provider;
            try {
                provider = providerRegistry.get(providerId);
            } catch {
                return res.status(400).json({ error: `Unknown provider: ${providerId}` });
            }
            const releases = await provider.getReleases(mcVersion);
            const release = releases.find(r => r.id === releaseId);
            if (!release) return res.status(400).json({ error: 'Release not found for this version' });

            // Refuse before downloading anything when no installed Java can run it.
            // (Modpack versions carry their Minecraft version; the pack itself is checked again once downloaded.)
            const javaMcVersion = release.mcVersion ?? (provider.searchable ? null : mcVersion);
            if (javaMcVersion) {
                try {
                    await selectJavaRuntime(javaMcVersion);
                } catch (e: any) {
                    return res.status(400).json({ error: e.message });
                }
            }

            const job = startInstall(server, provider, mcVersion, release);
            res.status(202).json(job);
        } catch (error: any) {
            res.status(/already running/.test(error.message) ? 409 : 500).json({ error: error.message });
        }
    }

    static async installStatus(req: Request, res: Response) {
        res.json(getInstallJob(req.params.serverId));
    }
}
