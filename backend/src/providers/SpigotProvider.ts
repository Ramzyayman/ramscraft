import fs from 'fs';
import path from 'path';
import { ISoftwareProvider, ISoftwareRelease, IJavaCompatibility, InstallContext, InstallResult } from './ISoftwareProvider';
import { cacheService } from '../services/MetadataCacheService';
import { JavaVersionHelper } from './JavaVersionHelper';
import { LaunchConfig, launchArgs, memoryArgs } from './launch';
import { compareVersionsDesc, fetchJson, fetchText } from './http';

const HUB = 'https://hub.spigotmc.org';
const BUILDTOOLS_URL = `${HUB}/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar`;

/**
 * Spigot has no downloadable server jars: it is compiled with the official BuildTools.
 * Versions come from hub.spigotmc.org/versions; BuildTools' work tree lives in the shared
 * cache so later builds only fetch what changed.
 */
export class SpigotProvider implements ISoftwareProvider {
    id = 'spigot';
    name = 'Spigot';
    category = 'Plugins';
    labels = { version: 'Minecraft Version', release: 'BuildTools Build' };
    note = 'Spigot is compiled from source with the official BuildTools. The first build takes several minutes and needs about 2 GB of free memory.';

    private CACHE_TTL = 1000 * 60 * 60;
    // ponytail: one build at a time host-wide; BuildTools' shared work tree isn't safe to use concurrently.
    private building = false;

    async getMcVersions(): Promise<string[]> {
        return cacheService.getCachedOrFetch(this.id, 'mc_versions', this.CACHE_TTL, async () => {
            const html = await fetchText(`${HUB}/versions/`, 'Spigot versions');
            const names = [...html.matchAll(/href="(\d+\.\d+(?:\.\d+)?)\.json"/g)].map(m => m[1]);
            return [...new Set(names)].sort(compareVersionsDesc);
        });
    }

    async getReleases(mcVersion: string): Promise<ISoftwareRelease[]> {
        return cacheService.getCachedOrFetch(this.id, `releases_${mcVersion}`, this.CACHE_TTL, async () => {
            const info = await fetchJson(`${HUB}/versions/${encodeURIComponent(mcVersion)}.json`, 'Spigot version info');
            // `name` is the Jenkins build that BuildTools --rev accepts, pinning exactly this build.
            return [{ id: String(info.name), displayVersion: `Latest for ${mcVersion} (build #${info.name})`, isStable: true }];
        });
    }

    async getJavaCompatibility(mcVersion: string): Promise<IJavaCompatibility> {
        return JavaVersionHelper.getStandardJavaRules(mcVersion);
    }

    async install(ctx: InstallContext): Promise<InstallResult> {
        if (this.building) throw new Error('Another Spigot build is already running on this host. Try again when it finishes.');
        this.building = true;
        try {
            const workDir = path.join(ctx.cacheDir, 'buildtools');
            fs.mkdirSync(workDir, { recursive: true });
            const jar = path.join(workDir, 'BuildTools.jar');
            await ctx.download(BUILDTOOLS_URL, jar, { label: 'Downloading BuildTools' });

            const java = await ctx.java();
            await ctx.run(java, ['-jar', jar, '--rev', ctx.release.id, '--compile', 'SPIGOT', '--nogui', '--output-dir', ctx.stagingDir, '--final-name', 'server.jar'],
                { cwd: workDir, label: 'Compiling Spigot with BuildTools', timeoutMs: 45 * 60_000 });

            if (!fs.existsSync(path.join(ctx.stagingDir, 'server.jar'))) throw new Error('BuildTools finished but did not produce a Spigot jar');
            return { launch: { jar: 'server.jar' }, files: ['server.jar'], releaseLabel: `build #${ctx.release.id}`, sourceUrl: BUILDTOOLS_URL };
        } finally {
            this.building = false;
        }
    }

    getStartupArgs(memoryMin: number, memoryMax: number, launch: LaunchConfig): string[] {
        return [...memoryArgs(memoryMin, memoryMax), ...launchArgs(launch)];
    }
}
