import fs from 'fs';
import path from 'path';
import { ISoftwareProvider, ISoftwareRelease, IJavaCompatibility, InstallContext, InstallResult } from './ISoftwareProvider';
import { cacheService } from '../services/MetadataCacheService';
import { JavaVersionHelper } from './JavaVersionHelper';
import { LaunchConfig, launchArgs, memoryArgs } from './launch';
import { fetchJson } from './http';

/** Top-level entries an installer produced, minus its own leftovers. */
export function stagedEntries(stagingDir: string, skip: (name: string) => boolean): string[] {
    return fs.readdirSync(stagingDir).filter(name => !skip(name) && !name.endsWith('.log'));
}

/** Fabric via the official installer (meta.fabricmc.net). Launches fabric-server-launch.jar. */
export class FabricProvider implements ISoftwareProvider {
    id = 'fabric';
    name = 'Fabric';
    category = 'Mod Loaders';
    labels = { version: 'Minecraft Version', release: 'Fabric Loader' };

    private META = 'https://meta.fabricmc.net/v2';
    private CACHE_TTL = 1000 * 60 * 60;

    async getMcVersions(): Promise<string[]> {
        return cacheService.getCachedOrFetch(this.id, 'mc_versions', this.CACHE_TTL, async () =>
            (await fetchJson<any[]>(`${this.META}/versions/game`, 'Fabric game versions')).map(v => v.version));
    }

    async getReleases(mcVersion: string): Promise<ISoftwareRelease[]> {
        return cacheService.getCachedOrFetch(this.id, `releases_${mcVersion}`, this.CACHE_TTL, async () =>
            (await fetchJson<any[]>(`${this.META}/versions/loader/${encodeURIComponent(mcVersion)}`, 'Fabric loaders'))
                .map(entry => ({
                    id: entry.loader.version,
                    displayVersion: `${entry.loader.version}${entry.loader.stable ? '' : ' (beta)'}`,
                    isStable: !!entry.loader.stable,
                })));
    }

    async getJavaCompatibility(mcVersion: string): Promise<IJavaCompatibility> {
        return JavaVersionHelper.getStandardJavaRules(mcVersion);
    }

    async install(ctx: InstallContext): Promise<InstallResult> {
        const installers = await fetchJson<any[]>(`${this.META}/versions/installer`, 'Fabric installer versions');
        const installer = installers.find(i => i.stable) ?? installers[0];
        if (!installer?.url) throw new Error('Fabric installer: no installer version published');

        const jar = path.join(ctx.stagingDir, 'fabric-installer.jar');
        await ctx.download(installer.url, jar, { label: `Downloading Fabric installer ${installer.version}` });
        const java = await ctx.java();
        await ctx.run(java, ['-jar', jar, 'server', '-dir', ctx.stagingDir, '-mcversion', ctx.mcVersion, '-loader', ctx.release.id, '-downloadMinecraft'],
            { cwd: ctx.stagingDir, label: 'Installing Fabric' });

        if (!fs.existsSync(path.join(ctx.stagingDir, 'fabric-server-launch.jar'))) {
            throw new Error('Fabric installer finished but did not create fabric-server-launch.jar');
        }
        return {
            launch: { jar: 'fabric-server-launch.jar' },
            files: stagedEntries(ctx.stagingDir, name => name === 'fabric-installer.jar'),
            sourceUrl: installer.url,
        };
    }

    getStartupArgs(memoryMin: number, memoryMax: number, launch: LaunchConfig): string[] {
        return [...memoryArgs(memoryMin, memoryMax), ...launchArgs(launch)];
    }
}
