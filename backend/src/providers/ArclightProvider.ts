import fs from 'fs';
import path from 'path';
import { ISoftwareProvider, ISoftwareRelease, IJavaCompatibility, InstallContext, InstallResult } from './ISoftwareProvider';
import { cacheService } from '../services/MetadataCacheService';
import { JavaVersionHelper } from './JavaVersionHelper';
import { LaunchConfig, launchArgs, memoryArgs } from './launch';
import { compareVersionsDesc, fetchJson } from './http';

interface ArclightAsset { id: string; name: string; url: string; digest?: string; loader: string; mcVersion: string; version: string; prerelease: boolean }

const ASSET_RE = /^arclight-(forge|neoforge|fabric)-(\d+\.\d+(?:\.\d+)?)-(.+?)\.jar$/;
const LOADER_NAMES: Record<string, string> = { forge: 'Forge', neoforge: 'NeoForge', fabric: 'Fabric' };

/**
 * Arclight (Bukkit plugins on Forge/NeoForge/Fabric), from the official GitHub releases.
 * The jar installs its loader and libraries on first launch, so installation runs it once
 * in staging until the server starts booting, then keeps only those files.
 */
export class ArclightProvider implements ISoftwareProvider {
    id = 'arclight';
    name = 'Arclight';
    category = 'Hybrid (Mods + Plugins)';
    labels = { version: 'Minecraft Version', release: 'Arclight Build' };
    note = 'Runs Bukkit/Spigot plugins alongside Forge, NeoForge or Fabric mods. Pick the loader flavour in the build list.';

    private CACHE_TTL = 1000 * 60 * 60; // GitHub allows 60 unauthenticated requests/hour

    private assets(): Promise<ArclightAsset[]> {
        return cacheService.getCachedOrFetch(this.id, 'assets', this.CACHE_TTL, async () => {
            const releases = await fetchJson<any[]>('https://api.github.com/repos/IzzelAliz/Arclight/releases?per_page=100', 'Arclight releases');
            const out: ArclightAsset[] = [];
            for (const release of releases) {
                for (const asset of release.assets ?? []) {
                    const m = String(asset.name).match(ASSET_RE);
                    if (m) out.push({ id: String(asset.id), name: asset.name, url: asset.browser_download_url, digest: asset.digest, loader: m[1], mcVersion: m[2], version: m[3], prerelease: !!release.prerelease });
                }
            }
            return out;
        });
    }

    async getMcVersions(): Promise<string[]> {
        return [...new Set((await this.assets()).map(a => a.mcVersion))].sort(compareVersionsDesc);
    }

    async getReleases(mcVersion: string): Promise<ISoftwareRelease[]> {
        return (await this.assets()).filter(a => a.mcVersion === mcVersion).map(a => ({
            id: a.id,
            displayVersion: `${LOADER_NAMES[a.loader]} · ${a.version}${a.prerelease ? ' (pre-release)' : ''}`,
            isStable: !a.prerelease,
        }));
    }

    async getJavaCompatibility(mcVersion: string): Promise<IJavaCompatibility> {
        return JavaVersionHelper.getStandardJavaRules(mcVersion);
    }

    async install(ctx: InstallContext): Promise<InstallResult> {
        const asset = (await this.assets()).find(a => a.id === ctx.release.id);
        if (!asset) throw new Error('Arclight build not found; refresh the build list and try again.');

        const sha256 = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : undefined;
        await ctx.download(asset.url, path.join(ctx.stagingDir, 'arclight.jar'), { checksum: sha256, algo: sha256 ? 'sha256' : undefined, label: `Downloading ${asset.name}` });

        // No eula.txt in staging: the server stops by itself after installing, before any world work.
        const java = await ctx.java();
        await ctx.run(java, ['-Xmx2G', '-jar', 'arclight.jar', 'nogui'], {
            cwd: ctx.stagingDir,
            label: `Installing ${LOADER_NAMES[asset.loader]} libraries for Arclight`,
            timeoutMs: 20 * 60_000,
            until: /You need to agree to the EULA|Starting minecraft server|Loading Minecraft/,
        });

        if (!fs.existsSync(path.join(ctx.stagingDir, 'libraries'))) throw new Error('Arclight did not download its libraries; see the log above.');
        // Only software files: generated default configs must not overwrite the server's own.
        const files = fs.readdirSync(ctx.stagingDir).filter(f => ['arclight.jar', 'libraries', '.arclight'].includes(f) || /-installer\.jar$/.test(f));
        return {
            launch: { jar: 'arclight.jar' },
            files,
            releaseLabel: `${LOADER_NAMES[asset.loader]} ${asset.version}`,
            sourceUrl: asset.url,
        };
    }

    getStartupArgs(memoryMin: number, memoryMax: number, launch: LaunchConfig): string[] {
        return [...memoryArgs(memoryMin, memoryMax), ...launchArgs(launch)];
    }
}
