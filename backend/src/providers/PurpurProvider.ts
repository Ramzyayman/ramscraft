import path from 'path';
import { ISoftwareProvider, ISoftwareRelease, IJavaCompatibility, InstallContext, InstallResult } from './ISoftwareProvider';
import { cacheService } from '../services/MetadataCacheService';
import { JavaVersionHelper } from './JavaVersionHelper';
import { LaunchConfig, launchArgs } from './launch';
import { aikarFlags } from './PaperProvider';
import { fetchJson } from './http';

/** Purpur (Paper fork). API: https://api.purpurmc.org/v2/purpur */
export class PurpurProvider implements ISoftwareProvider {
    id = 'purpur';
    name = 'Purpur';
    category = 'High Performance Plugins';
    labels = { version: 'Minecraft Version', release: 'Build' };

    private BASE_URL = 'https://api.purpurmc.org/v2/purpur';
    private CACHE_TTL = 1000 * 60 * 60;

    async getMcVersions(): Promise<string[]> {
        return cacheService.getCachedOrFetch(this.id, 'mc_versions', this.CACHE_TTL, async () => {
            const data = await fetchJson(this.BASE_URL, 'Purpur versions');
            return [...(data.versions as string[])].reverse();
        });
    }

    async getReleases(mcVersion: string): Promise<ISoftwareRelease[]> {
        return cacheService.getCachedOrFetch(this.id, `releases_${mcVersion}`, this.CACHE_TTL, async () => {
            const data = await fetchJson(`${this.BASE_URL}/${encodeURIComponent(mcVersion)}`, 'Purpur builds');
            return [...(data.builds?.all as string[] ?? [])].reverse().map(build => ({
                id: build,
                displayVersion: `${mcVersion}-#${build}`,
                isStable: true,
            }));
        });
    }

    async getJavaCompatibility(mcVersion: string): Promise<IJavaCompatibility> {
        return JavaVersionHelper.getStandardJavaRules(mcVersion);
    }

    async install(ctx: InstallContext): Promise<InstallResult> {
        const base = `${this.BASE_URL}/${encodeURIComponent(ctx.mcVersion)}/${encodeURIComponent(ctx.release.id)}`;
        const build = await fetchJson(base, 'Purpur build info');
        if (build.result && build.result !== 'SUCCESS') throw new Error(`Purpur build ${ctx.release.id} did not succeed (${build.result}); pick another build.`);
        const url = `${base}/download`;
        await ctx.download(url, path.join(ctx.stagingDir, 'server.jar'), { checksum: build.md5, algo: build.md5 ? 'md5' : undefined, label: 'Downloading Purpur' });
        return { launch: { jar: 'server.jar' }, files: ['server.jar'], sourceUrl: url };
    }

    getStartupArgs(memoryMin: number, memoryMax: number, launch: LaunchConfig): string[] {
        return [...aikarFlags(memoryMin, memoryMax), ...launchArgs(launch)];
    }
}
