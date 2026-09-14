import fs from 'fs';
import path from 'path';
import { ISoftwareProvider, ISoftwareRelease, IJavaCompatibility, InstallContext, InstallResult } from './ISoftwareProvider';
import { cacheService } from '../services/MetadataCacheService';
import { JavaVersionHelper } from './JavaVersionHelper';
import { LaunchConfig, launchArgs, memoryArgs } from './launch';
import { fetchJson, fetchText } from './http';
import { stagedEntries } from './FabricProvider';

const INSTALLER_LEFTOVERS = new Set(['installer.jar', 'run.bat', 'run.sh', 'user_jvm_args.txt']);

/**
 * Run a Forge-family installer (`--installServer`) in the staging dir and work out how
 * to launch the result: modern installers write libraries/<group path>/<version>/unix_args.txt,
 * old ones (<= 1.16) write a runnable forge-*.jar.
 */
export async function installForgeStyle(ctx: InstallContext, opts: {
    name: string; installerUrl: string; argsFile: string; legacyJar?: RegExp;
}): Promise<InstallResult> {
    const installer = path.join(ctx.stagingDir, 'installer.jar');
    let sha1: string | undefined;
    try { sha1 = (await fetchText(`${opts.installerUrl}.sha1`, `${opts.name} installer checksum`)).trim().split(/\s+/)[0]; } catch { /* no published checksum */ }
    await ctx.download(opts.installerUrl, installer, { checksum: sha1, algo: sha1 ? 'sha1' : undefined, label: `Downloading ${opts.name} installer` });

    const java = await ctx.java();
    // Every installer generation installs into the working directory when given no path.
    await ctx.run(java, ['-jar', installer, '--installServer'], { cwd: ctx.stagingDir, label: `Installing ${opts.name}`, timeoutMs: 20 * 60_000 });

    let launch: LaunchConfig | null = fs.existsSync(path.join(ctx.stagingDir, opts.argsFile)) ? { argsFile: opts.argsFile } : null;
    if (!launch && opts.legacyJar) {
        const jar = fs.readdirSync(ctx.stagingDir).find(f => opts.legacyJar!.test(f) && !/installer|shim/.test(f));
        if (jar) launch = { jar };
    }
    if (!launch) throw new Error(`${opts.name} installer finished but no launch file was found (expected ${opts.argsFile})`);

    return {
        launch,
        files: stagedEntries(ctx.stagingDir, name => INSTALLER_LEFTOVERS.has(name)),
        sourceUrl: opts.installerUrl,
    };
}

/** MinecraftForge via its official installer (maven.minecraftforge.net). */
export class ForgeProvider implements ISoftwareProvider {
    id = 'forge';
    name = 'Forge';
    category = 'Mod Loaders';
    labels = { version: 'Minecraft Version', release: 'Forge Version' };

    private FILES = 'https://files.minecraftforge.net/net/minecraftforge/forge';
    private MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
    private CACHE_TTL = 1000 * 60 * 60;

    /** { "1.21.1": ["1.21.1-52.0.1", ...] } oldest first. */
    private metadata(): Promise<Record<string, string[]>> {
        return cacheService.getCachedOrFetch(this.id, 'maven_metadata', this.CACHE_TTL, () => fetchJson(`${this.FILES}/maven-metadata.json`, 'Forge versions'));
    }

    async getMcVersions(): Promise<string[]> {
        // Server installers (--installServer) exist from 1.5.2; older builds have none.
        return Object.keys(await this.metadata())
            .filter(mc => mc.localeCompare('1.5.2', undefined, { numeric: true }) >= 0)
            .reverse();
    }

    async getReleases(mcVersion: string): Promise<ISoftwareRelease[]> {
        const versions = (await this.metadata())[mcVersion];
        if (!versions) throw new Error(`Forge has no builds for Minecraft ${mcVersion}`);
        const promos = await cacheService.getCachedOrFetch(this.id, 'promotions', this.CACHE_TTL, () => fetchJson(`${this.FILES}/promotions_slim.json`, 'Forge promotions'));
        const recommended = promos.promos?.[`${mcVersion}-recommended`];
        const latest = promos.promos?.[`${mcVersion}-latest`];
        return [...versions].reverse().map(full => {
            const forge = full.slice(mcVersion.length + 1).replace(new RegExp(`-${mcVersion.replace(/\./g, '\\.')}$`), '');
            const tag = forge === recommended ? ' (Recommended)' : forge === latest ? ' (Latest)' : '';
            // Forge publishes no stability channel beyond the recommended/latest promotions.
            return { id: full, displayVersion: `${forge}${tag}`, isStable: true };
        });
    }

    async getJavaCompatibility(mcVersion: string): Promise<IJavaCompatibility> {
        return JavaVersionHelper.getStandardJavaRules(mcVersion);
    }

    async install(ctx: InstallContext): Promise<InstallResult> {
        const full = ctx.release.id;
        return installForgeStyle(ctx, {
            name: 'Forge',
            installerUrl: `${this.MAVEN}/${full}/forge-${full}-installer.jar`,
            argsFile: `libraries/net/minecraftforge/forge/${full}/unix_args.txt`,
            legacyJar: /^forge-.*\.jar$/,
        });
    }

    getStartupArgs(memoryMin: number, memoryMax: number, launch: LaunchConfig): string[] {
        return [...memoryArgs(memoryMin, memoryMax), ...launchArgs(launch)];
    }
}
