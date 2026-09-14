import fs from 'fs';
import { ISoftwareProvider, ISoftwareRelease, IJavaCompatibility, InstallContext, InstallResult, IVersionOption } from './ISoftwareProvider';
import { JavaVersionHelper } from './JavaVersionHelper';
import { LaunchConfig, launchArgs, memoryArgs } from './launch';
import { IModpackPlatform, ModrinthPlatform } from './modpacks/ModrinthPlatform';
import { FabricProvider } from './FabricProvider';
import { QuiltProvider } from './QuiltProvider';
import { ForgeProvider } from './ForgeProvider';
import { NeoForgeProvider } from './NeoForgeProvider';

/**
 * Modpacks: the version step picks a pack ("<platform>:<project>"), the release step a pack
 * version. Installing downloads the pack's server files and overrides, then installs the
 * pack's loader with the regular loader provider into the same staging directory.
 */
export class ModpackProvider implements ISoftwareProvider {
    id = 'modpacks';
    name = 'Modpacks';
    category = 'Modpacks';
    labels = { version: 'Modpack', release: 'Modpack Version' };
    note = 'Modrinth modpacks (.mrpack). Server-side mods and configs from the pack are installed together with its Fabric, Quilt, Forge or NeoForge loader. Your world and server.properties are kept.';
    searchable = true;

    private platforms = new Map<string, IModpackPlatform>([['modrinth', new ModrinthPlatform()]]);
    private loaders = {
        fabric: new FabricProvider(),
        quilt: new QuiltProvider(),
        forge: new ForgeProvider(),
        neoforge: new NeoForgeProvider(),
    };

    private parse(choice: string): { platform: IModpackPlatform; projectId: string } {
        const [platformId, projectId] = choice.split(':');
        const platform = this.platforms.get(platformId);
        if (!platform || !projectId) throw new Error(`Unknown modpack "${choice}"`);
        return { platform, projectId };
    }

    async getMcVersions(query = ''): Promise<IVersionOption[]> {
        const results = await Promise.all([...this.platforms.values()].map(p => p.search(query)));
        return results.flat();
    }

    async getReleases(choice: string): Promise<ISoftwareRelease[]> {
        const { platform, projectId } = this.parse(choice);
        return platform.getVersions(projectId);
    }

    async getJavaCompatibility(_choice: string, release: ISoftwareRelease): Promise<IJavaCompatibility> {
        return JavaVersionHelper.getStandardJavaRules(release.mcVersion ?? '');
    }

    async install(ctx: InstallContext): Promise<InstallResult> {
        const { platform, projectId } = this.parse(ctx.mcVersion);
        const pack = await platform.install(ctx, projectId, ctx.release.id);

        let loaderVersion = pack.loader.version;
        if (pack.loader.provider === 'forge') {
            // .mrpack stores the bare Forge version; Forge's maven id is "<mc>-<forge>[-<mc>]".
            const ids = (await this.loaders.forge.getReleases(pack.mcVersion)).map(r => r.id);
            loaderVersion = ids.find(id => id === `${pack.mcVersion}-${loaderVersion}` || id.startsWith(`${pack.mcVersion}-${loaderVersion}-`)) ?? `${pack.mcVersion}-${loaderVersion}`;
        } else if (pack.loader.provider === 'neoforge' && pack.mcVersion === '1.20.1' && !loaderVersion.startsWith('1.20.1-')) {
            loaderVersion = `1.20.1-${loaderVersion}`;
        }

        ctx.progress(`Installing ${pack.loader.provider} ${loaderVersion}`, null);
        const loaderRelease = { id: loaderVersion, displayVersion: loaderVersion, isStable: true };
        const loaderResult = await this.loaders[pack.loader.provider].install({ ...ctx, mcVersion: pack.mcVersion, release: loaderRelease, java: v => ctx.java(v ?? pack.mcVersion) });

        return {
            launch: loaderResult.launch,
            // Pack files (mods, config, ...) plus the loader's files.
            files: fs.readdirSync(ctx.stagingDir).filter(f => !f.endsWith('.log') && !/installer\.jar$/.test(f) && !['run.bat', 'run.sh', 'user_jvm_args.txt'].includes(f)),
            // A previous pack's mods would conflict, so mods/ is replaced rather than merged.
            replace: ['libraries', 'mods'],
            mcVersion: pack.mcVersion,
            releaseLabel: `${pack.label} (${pack.loader.provider} ${pack.loader.version})`,
            sourceUrl: pack.sourceUrl,
        };
    }

    getStartupArgs(memoryMin: number, memoryMax: number, launch: LaunchConfig): string[] {
        return [...memoryArgs(memoryMin, memoryMax), ...launchArgs(launch)];
    }
}
