import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { InstallContext, IVersionOption, ISoftwareRelease } from '../ISoftwareProvider';
import { cacheService } from '../../services/MetadataCacheService';
import { fetchJson } from '../http';
import { isInside } from '../../utils/paths';

/** What a modpack install leaves in staging, and which loader it needs. */
export interface ModpackContents {
    mcVersion: string;
    loader: { provider: 'fabric' | 'quilt' | 'forge' | 'neoforge'; version: string };
    label: string;
    sourceUrl: string;
}

/** A modpack source. Add CurseForge, FTB, etc. by implementing this and registering it in ModpackProvider. */
export interface IModpackPlatform {
    id: string;
    name: string;
    search(query: string): Promise<IVersionOption[]>;      // option ids are "<platform>:<project>"
    getVersions(projectId: string): Promise<ISoftwareRelease[]>;
    /** Download the pack's server-side files and overrides into ctx.stagingDir. */
    install(ctx: InstallContext, projectId: string, versionId: string): Promise<ModpackContents>;
}

const API = 'https://api.modrinth.com/v2';
// The .mrpack spec only allows downloads from these hosts.
const ALLOWED_HOSTS = new Set(['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com']);
const LOADER_KEYS: Record<string, ModpackContents['loader']['provider']> = {
    'fabric-loader': 'fabric', 'quilt-loader': 'quilt', 'forge': 'forge', 'neoforge': 'neoforge',
};

function safeRelative(root: string, rel: string): string {
    const norm = rel.replace(/\\/g, '/');
    const target = path.resolve(root, norm);
    if (path.isAbsolute(norm) || norm.split('/').includes('..') || !isInside(root, target)) {
        throw new Error(`Modpack contains an unsafe path: ${rel}`);
    }
    return target;
}

export class ModrinthPlatform implements IModpackPlatform {
    id = 'modrinth';
    name = 'Modrinth';
    private CACHE_TTL = 1000 * 60 * 30;

    async search(query: string): Promise<IVersionOption[]> {
        const q = query.trim();
        return cacheService.getCachedOrFetch('modpacks', `modrinth_search_${q.toLowerCase()}`, this.CACHE_TTL, async () => {
            const facets = encodeURIComponent(JSON.stringify([['project_type:modpack'], ['server_side:required', 'server_side:optional']]));
            const url = `${API}/search?limit=50&index=${q ? 'relevance' : 'downloads'}&facets=${facets}${q ? `&query=${encodeURIComponent(q)}` : ''}`;
            const data = await fetchJson(url, 'Modrinth search');
            return data.hits.map((h: any) => ({
                id: `modrinth:${h.project_id}`,
                label: `${h.title} (${Intl.NumberFormat('en', { notation: 'compact' }).format(h.downloads)} downloads)`,
            }));
        });
    }

    async getVersions(projectId: string): Promise<ISoftwareRelease[]> {
        return cacheService.getCachedOrFetch('modpacks', `modrinth_versions_${projectId}`, this.CACHE_TTL, async () => {
            const versions = await fetchJson<any[]>(`${API}/project/${encodeURIComponent(projectId)}/version`, 'Modrinth modpack versions');
            return versions
                .filter(v => v.files?.some((f: any) => f.filename.endsWith('.mrpack')) && v.loaders?.some((l: string) => l.replace('-loader', '') in { fabric: 1, quilt: 1, forge: 1, neoforge: 1 }))
                .map(v => ({
                    id: v.id,
                    displayVersion: `${v.version_number} · MC ${v.game_versions.join(', ')} · ${v.loaders.join('/')}${v.version_type === 'release' ? '' : ` (${v.version_type})`}`,
                    isStable: v.version_type === 'release',
                    mcVersion: v.game_versions[0],
                }));
        });
    }

    async install(ctx: InstallContext, projectId: string, versionId: string): Promise<ModpackContents> {
        const [project, version] = await Promise.all([
            fetchJson(`${API}/project/${encodeURIComponent(projectId)}`, 'Modrinth modpack'),
            fetchJson(`${API}/version/${encodeURIComponent(versionId)}`, 'Modrinth modpack version'),
        ]);
        if (version.project_id !== project.id) throw new Error('That version does not belong to the selected modpack');
        const file = version.files.find((f: any) => f.primary && f.filename.endsWith('.mrpack')) ?? version.files.find((f: any) => f.filename.endsWith('.mrpack'));
        if (!file) throw new Error('This modpack version has no .mrpack file');

        const packPath = path.join(ctx.stagingDir, '..', `${path.basename(ctx.stagingDir)}.mrpack`);
        await ctx.download(file.url, packPath, { checksum: file.hashes.sha512, algo: 'sha512', label: `Downloading ${project.title} ${version.version_number}` });

        try {
            const zip = new AdmZip(packPath);
            const indexEntry = zip.getEntry('modrinth.index.json');
            if (!indexEntry) throw new Error('Not a valid .mrpack (modrinth.index.json missing)');
            const index = JSON.parse(indexEntry.getData().toString('utf8'));
            if (index.game !== 'minecraft' || index.formatVersion !== 1) throw new Error(`Unsupported .mrpack format (game=${index.game}, formatVersion=${index.formatVersion})`);

            const mcVersion = index.dependencies?.minecraft;
            const loaderKey = Object.keys(LOADER_KEYS).find(k => index.dependencies?.[k]);
            if (!mcVersion || !loaderKey) throw new Error('Modpack does not declare a Minecraft version and a supported loader (Fabric, Quilt, Forge, NeoForge)');

            // Server-side files: everything not marked unsupported on servers, hash-verified.
            const files = (index.files ?? []).filter((f: any) => f.env?.server !== 'unsupported');
            const totalBytes = files.reduce((n: number, f: any) => n + (f.fileSize || 0), 0) || 1;
            let doneBytes = 0, doneCount = 0;
            const queue = [...files];
            const worker = async () => {
                for (let f = queue.shift(); f; f = queue.shift()) {
                    const dest = safeRelative(ctx.stagingDir, f.path);
                    const url = (f.downloads ?? []).find((u: string) => { try { return ALLOWED_HOSTS.has(new URL(u).host); } catch { return false; } });
                    if (!url) throw new Error(`No allowed download source for ${f.path}`);
                    const [algo, checksum] = f.hashes?.sha512 ? ['sha512', f.hashes.sha512] : ['sha1', f.hashes?.sha1];
                    await ctx.download(url, dest, { checksum, algo: checksum ? algo as 'sha512' | 'sha1' : undefined, quiet: true });
                    doneBytes += f.fileSize || 0;
                    doneCount++;
                    ctx.progress('Downloading modpack files', doneBytes / totalBytes * 100, `${doneCount} / ${files.length}: ${path.basename(f.path)}`);
                }
            };
            await Promise.all(Array.from({ length: 6 }, worker));

            // Overrides, then server-specific overrides on top.
            ctx.progress('Applying modpack overrides', null);
            for (const prefix of ['overrides/', 'server-overrides/']) {
                for (const entry of zip.getEntries()) {
                    if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
                    const dest = safeRelative(ctx.stagingDir, entry.entryName.slice(prefix.length));
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                    fs.writeFileSync(dest, entry.getData());
                }
            }

            return {
                mcVersion,
                loader: { provider: LOADER_KEYS[loaderKey], version: String(index.dependencies[loaderKey]) },
                label: `${index.name || project.title} ${version.version_number}`,
                sourceUrl: `https://modrinth.com/modpack/${project.slug}/version/${version.id}`,
            };
        } finally {
            fs.rmSync(packPath, { force: true });
        }
    }
}
