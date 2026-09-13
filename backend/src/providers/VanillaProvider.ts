import { ISoftwareProvider, ISoftwareRelease, IJavaCompatibility } from './ISoftwareProvider';
import { cacheService } from '../services/MetadataCacheService';
import { JavaVersionHelper } from './JavaVersionHelper';

export class VanillaProvider implements ISoftwareProvider {
    id = 'vanilla';
    name = 'Vanilla (Mojang)';
    category = 'Official';

    private MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';
    private CACHE_TTL = 1000 * 60 * 60 * 6; // 6 hours

    async getMcVersions(): Promise<string[]> {
        return cacheService.getCachedOrFetch(this.id, 'mc_versions', this.CACHE_TTL, async () => {
            const response = await fetch(this.MANIFEST_URL);
            if (!response.ok) throw new Error('Failed to fetch Mojang manifest');
            const data = await response.json();
            return data.versions.filter((v: any) => v.type === 'release' || v.type === 'snapshot').map((v: any) => v.id);
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

    async getDownloadInfo(mcVersion: string, release: ISoftwareRelease): Promise<{ url: string, checksum?: string }> {
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
                checksum: meta.downloads.server.sha1
            };
        });
    }

    async install(serverDir: string, mcVersion: string, release: ISoftwareRelease): Promise<void> {
        console.log(`[VanillaProvider] Installation prepared for ${mcVersion}`);
    }

    getStartupArgs(memoryMin: number, memoryMax: number, jarName: string): string[] {
        return ['-Xms' + memoryMin + 'M', '-Xmx' + memoryMax + 'M', '-jar', jarName, 'nogui'];
    }
}
