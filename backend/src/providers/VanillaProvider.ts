import path from 'path';
import { ISoftwareProvider, ISoftwareRelease, IJavaCompatibility, IDownloadInfo, InstallContext, InstallResult } from './ISoftwareProvider';
import { cacheService } from '../services/MetadataCacheService';
import { JavaVersionHelper } from './JavaVersionHelper';
import { LaunchConfig, launchArgs, memoryArgs } from './launch';

export class VanillaProvider implements ISoftwareProvider {
    id = 'vanilla';
    name = 'Vanilla (Mojang)';
    category = 'Official';
    labels = { version: 'Minecraft Version', release: 'Server Release' };
    note?: string;

    /** Mojang manifest entry type listed by this provider. */
    protected versionType = 'release';

    private MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
    private CACHE_TTL = 1000 * 60 * 60 * 6; // 6 hours

    async getMcVersions(): Promise<string[]> {
        return cacheService.getCachedOrFetch(this.id, `mc_versions_${this.versionType}`, this.CACHE_TTL, async () => {
            const response = await fetch(this.MANIFEST_URL);
            if (!response.ok) throw new Error('Failed to fetch Mojang manifest');
            const data = await response.json();
            return data.versions.filter((v: any) => v.type === this.versionType).map((v: any) => v.id);
        });
    }

    async getReleases(mcVersion: string): Promise<ISoftwareRelease[]> {
        // Vanilla effectively only has 1 release per MC version (itself).
        // But we need the manifest URL to download it.
        return cacheService.getCachedOrFetch(this.id, `releases_${mcVersion}`, this.CACHE_TTL, async () => {
            const response = await fetch(this.MANIFEST_URL);
            const data = await response.json();
            const versionData = data.versions.find((v: any) => v.id === mcVersion);
            if (!versionData) throw new Error(`Version ${mcVersion} not found in manifest`);

            return [{
                id: versionData.id,
                displayVersion: versionData.id,
                isStable: versionData.type === 'release'
            }];
        });
    }

    async getJavaCompatibility(mcVersion: string): Promise<IJavaCompatibility> {
        return JavaVersionHelper.getStandardJavaRules(mcVersion);
    }

    async getDownloadInfo(mcVersion: string, release: ISoftwareRelease): Promise<IDownloadInfo> {
        return cacheService.getCachedOrFetch(this.id, `download_${release.id}`, this.CACHE_TTL, async () => {
            const manifestResponse = await fetch(this.MANIFEST_URL);
            const manifest = await manifestResponse.json();
            const versionMeta = manifest.versions.find((v: any) => v.id === release.id);
            if (!versionMeta) throw new Error('Version not found');

            const metaResponse = await fetch(versionMeta.url);
            const meta = await metaResponse.json();
            if (!meta.downloads?.server) throw new Error('Server JAR not available for this version');

            return {
                url: meta.downloads.server.url,
                checksum: meta.downloads.server.sha1,
                checksumAlgo: 'sha1' as const
            };
        });
    }

    async install(ctx: InstallContext): Promise<InstallResult> {
        const info = await this.getDownloadInfo(ctx.mcVersion, ctx.release);
        await ctx.download(info.url, path.join(ctx.stagingDir, 'server.jar'), { checksum: info.checksum, algo: info.checksumAlgo, label: 'Downloading server jar' });
        return { launch: { jar: 'server.jar' }, files: ['server.jar'], sourceUrl: info.url };
    }

    getStartupArgs(memoryMin: number, memoryMax: number, launch: LaunchConfig): string[] {
        return [...memoryArgs(memoryMin, memoryMax), ...launchArgs(launch)];
    }
}

/** Mojang development builds (snapshots, pre-releases, release candidates): same manifest and server jars. */
export class SnapshotProvider extends VanillaProvider {
    id = 'snapshot';
    name = 'Snapshot';
    category = 'Official (Preview)';
    labels = { version: 'Snapshot Version', release: 'Server Release' };
    note = 'Mojang development builds. Back up your world first: snapshots can corrupt worlds, and a world opened in a snapshot may not load in older versions.';
    protected versionType = 'snapshot';
}
