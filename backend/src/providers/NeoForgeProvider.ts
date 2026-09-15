import { ISoftwareProvider, ISoftwareRelease, IJavaCompatibility, InstallContext, InstallResult } from './ISoftwareProvider';
import { cacheService } from '../services/MetadataCacheService';
import { JavaVersionHelper } from './JavaVersionHelper';
import { LaunchConfig, launchArgs, memoryArgs } from './launch';
import { compareVersionsDesc, fetchText, neoForgeMcVersion } from './http';
import { installForgeStyle } from './ForgeProvider';

export { neoForgeMcVersion };

const MAVEN = 'https://maven.neoforged.net/releases/net/neoforged';

/** NeoForge via its official installer (maven.neoforged.net). */
export class NeoForgeProvider implements ISoftwareProvider {
    id = 'neoforge';
    name = 'NeoForge';
    category = 'Mod Loaders';
    labels = { version: 'Minecraft Version', release: 'NeoForge Version' };

    private CACHE_TTL = 1000 * 60 * 60;

    private async allVersions(): Promise<string[]> {
        return cacheService.getCachedOrFetch(this.id, 'all_versions', this.CACHE_TTL, async () => {
            const parse = (xml: string) => [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
            const modern = parse(await fetchText(`${MAVEN}/neoforge/maven-metadata.xml`, 'NeoForge versions'));
            const legacy = parse(await fetchText(`${MAVEN}/forge/maven-metadata.xml`, 'NeoForge 1.20.1 versions')).filter(v => v.startsWith('1.20.1-'));
            return [...modern, ...legacy];
        });
    }

    async getMcVersions(): Promise<string[]> {
        const mcs = new Set((await this.allVersions()).map(neoForgeMcVersion).filter((v): v is string => !!v));
        return [...mcs].sort(compareVersionsDesc);
    }

    async getReleases(mcVersion: string): Promise<ISoftwareRelease[]> {
        return (await this.allVersions())
            .filter(v => neoForgeMcVersion(v) === mcVersion)
            .sort(compareVersionsDesc)
            .map(v => {
                const stable = !/beta|alpha/i.test(v);
                return { id: v, displayVersion: `${v}${stable ? '' : ' (beta)'}`, isStable: stable };
            });
    }

    async getJavaCompatibility(mcVersion: string): Promise<IJavaCompatibility> {
        return JavaVersionHelper.getStandardJavaRules(mcVersion);
    }

    async install(ctx: InstallContext): Promise<InstallResult> {
        const v = ctx.release.id;
        const legacy = v.startsWith('1.20.1-');
        const artifact = legacy ? 'forge' : 'neoforge';
        return installForgeStyle(ctx, {
            name: 'NeoForge',
            installerUrl: `${MAVEN}/${artifact}/${v}/${artifact}-${v}-installer.jar`,
            argsFile: `libraries/net/neoforged/${artifact}/${v}/unix_args.txt`,
        });
    }

    getStartupArgs(memoryMin: number, memoryMax: number, launch: LaunchConfig): string[] {
        return [...memoryArgs(memoryMin, memoryMax), ...launchArgs(launch)];
    }
}
