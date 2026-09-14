import fs from 'fs';
import path from 'path';
import { ISoftwareProvider, ISoftwareRelease, IJavaCompatibility, InstallContext, InstallResult } from './ISoftwareProvider';
import { cacheService } from '../services/MetadataCacheService';
import { JavaVersionHelper } from './JavaVersionHelper';
import { LaunchConfig, launchArgs, memoryArgs } from './launch';
import { compareVersionsDesc, fetchJson } from './http';
import { stagedEntries } from './FabricProvider';

/** Quilt via the official installer (meta.quiltmc.org). Launches quilt-server-launch.jar. */
export class QuiltProvider implements ISoftwareProvider {
    id = 'quilt';
    name = 'Quilt';
    category = 'Mod Loaders';
    labels = { version: 'Minecraft Version', release: 'Quilt Loader' };

    private META = 'https://meta.quiltmc.org/v3';
    private CACHE_TTL = 1000 * 60 * 60;

    async getMcVersions(): Promise<string[]> {
        return cacheService.getCachedOrFetch(this.id, 'mc_versions', this.CACHE_TTL, async () =>
            (await fetchJson<any[]>(`${this.META}/versions/game`, 'Quilt game versions')).map(v => v.version));
    }

    async getReleases(mcVersion: string): Promise<ISoftwareRelease[]> {
        // Quilt's meta returns every loader version for every game version, unordered: sort newest first.
        return cacheService.getCachedOrFetch(this.id, `releases_v2_${mcVersion}`, this.CACHE_TTL, async () =>
            (await fetchJson<any[]>(`${this.META}/versions/loader/${encodeURIComponent(mcVersion)}`, 'Quilt loaders'))
                .map(entry => entry.loader.version as string)
                .sort(compareVersionsDesc)
                .map(version => {
                    const stable = !/-(alpha|beta|pre|rc)/i.test(version);
                    return { id: version, displayVersion: `${version}${stable ? '' : ' (beta)'}`, isStable: stable };
                }));
    }

    async getJavaCompatibility(mcVersion: string): Promise<IJavaCompatibility> {
        return JavaVersionHelper.getStandardJavaRules(mcVersion);
    }

    async install(ctx: InstallContext): Promise<InstallResult> {
        const installers = await fetchJson<any[]>(`${this.META}/versions/installer`, 'Quilt installer versions');
        const installer = installers[0];
        if (!installer?.url) throw new Error('Quilt installer: no installer version published');

        const jar = path.join(ctx.stagingDir, 'quilt-installer.jar');
        await ctx.download(installer.url, jar, { label: `Downloading Quilt installer ${installer.version}` });
        const java = await ctx.java();
        await ctx.run(java, ['-jar', jar, 'install', 'server', ctx.mcVersion, ctx.release.id, '--download-server', `--install-dir=${ctx.stagingDir}`],
            { cwd: ctx.stagingDir, label: 'Installing Quilt' });

        if (!fs.existsSync(path.join(ctx.stagingDir, 'quilt-server-launch.jar'))) {
            throw new Error('Quilt installer finished but did not create quilt-server-launch.jar');
        }
        return {
            launch: { jar: 'quilt-server-launch.jar' },
            files: stagedEntries(ctx.stagingDir, name => name === 'quilt-installer.jar'),
            sourceUrl: installer.url,
        };
    }

    getStartupArgs(memoryMin: number, memoryMax: number, launch: LaunchConfig): string[] {
        return [...memoryArgs(memoryMin, memoryMax), ...launchArgs(launch)];
    }
}
