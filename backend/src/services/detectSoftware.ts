import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { readNbt } from '../utils/nbt';
import { isInside } from '../utils/paths';
import { LaunchConfig } from '../providers/launch';
import { compareVersionsDesc, neoForgeMcVersion } from '../providers/http';

/**
 * Recognise the server software in a server folder that RamsCraft did not install itself
 * (e.g. an uploaded backup of a server from someone's PC), so it can be started without reinstalling.
 */
export interface DetectedSoftware {
    provider: string;          // RamsCraft provider id
    mcVersion: string | null;  // null when neither the software nor the world says
    releaseId: string;
    launch: LaunchConfig;
}

const exists = (...p: string[]) => fs.existsSync(path.join(...p));
const subdirs = (dir: string) => {
    try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
};
const newest = (versions: string[]) => [...versions].sort(compareVersionsDesc)[0];
const readJson = (file: string) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

function readProperty(serverDir: string, key: string): string | null {
    try {
        const line = fs.readFileSync(path.join(serverDir, 'server.properties'), 'utf8').split(/\r?\n/).find(l => l.startsWith(`${key}=`));
        return line ? line.slice(key.length + 1).trim() : null;
    } catch {
        return null;
    }
}

/** Minecraft version the world was last opened with (level.dat Data.Version.Name). */
export function worldVersion(serverDir: string): string | null {
    const file = path.resolve(serverDir, readProperty(serverDir, 'level-name') || 'world', 'level.dat');
    if (!isInside(serverDir, file)) return null;
    try {
        const name = readNbt(fs.readFileSync(file))?.Data?.Version?.Name;
        return typeof name === 'string' && name ? name : null;
    } catch {
        return null;
    }
}

/** version.json inside a server jar (vanilla, Paper and Purpur jars all ship one). */
function jarVersion(jar: string): string | null {
    try {
        const entry = new AdmZip(jar).getEntry('version.json');
        const json = entry ? JSON.parse(entry.getData().toString('utf8')) : null;
        return typeof json?.id === 'string' ? json.id : typeof json?.name === 'string' ? json.name : null;
    } catch {
        return null;
    }
}

function rootJars(serverDir: string): string[] {
    try {
        return fs.readdirSync(serverDir, { withFileTypes: true })
            .filter(d => d.isFile() && /\.jar$/i.test(d.name) && !/installer/i.test(d.name))
            .map(d => d.name)
            .sort();
    } catch {
        return [];
    }
}

/** The jar that starts the server: server.jar, else one named after the software, else the only jar. */
function pickJar(serverDir: string, hint?: RegExp): string | null {
    const jars = rootJars(serverDir);
    if (jars.includes('server.jar')) return 'server.jar';
    const named = hint ? jars.filter(j => hint.test(j)) : [];
    if (named.length) return named.sort(compareVersionsDesc)[0];
    return jars.length === 1 ? jars[0] : null;
}

const isSnapshot = (v: string) => /^\d{2}w\d{2}|-(pre|rc)/i.test(v);

export function detectSoftware(serverDir: string): DetectedSoftware | null {
    const world = worldVersion(serverDir);
    const jars = rootJars(serverDir);

    // Forge / NeoForge 1.17+: started from an @args file under libraries/.
    const argsLoaders: [string, string[]][] = [
        ['neoforge', ['net', 'neoforged', 'neoforge']],
        ['neoforge', ['net', 'neoforged', 'forge']], // NeoForge for 1.20.1
        ['forge', ['net', 'minecraftforge', 'forge']],
    ];
    for (const [provider, group] of argsLoaders) {
        const base = path.join(serverDir, 'libraries', ...group);
        const version = newest(subdirs(base).filter(v => exists(base, v, 'unix_args.txt')));
        if (version) {
            const fromLoader = provider === 'forge' || version.startsWith('1.20.1-') ? version.split('-')[0] : neoForgeMcVersion(version);
            return { provider, mcVersion: fromLoader ?? world, releaseId: version, launch: { argsFile: ['libraries', ...group, version, 'unix_args.txt'].join('/') } };
        }
    }

    // Older Forge (1.16 and below): forge-<mc>-<forge>.jar
    const legacyForge = jars.find(j => /^forge-\d[\w.]*-[\d.]+(-universal)?\.jar$/i.test(j));
    if (legacyForge) {
        const [, mc, version] = legacyForge.match(/^forge-([\d.]*\d)-([\d.]*\d)/i) ?? [];
        return { provider: 'forge', mcVersion: mc ?? world, releaseId: mc && version ? `${mc}-${version}` : 'unknown', launch: { jar: legacyForge } };
    }

    // Fabric / Quilt
    const fabricSingleJar = jars.find(j => /^fabric-server-mc\.(.+)-loader\.(.+)-launcher\..+\.jar$/i.test(j));
    if (fabricSingleJar) {
        const [, mc, loader] = fabricSingleJar.match(/^fabric-server-mc\.(.+)-loader\.(.+)-launcher\./i)!;
        return { provider: 'fabric', mcVersion: mc, releaseId: loader, launch: { jar: fabricSingleJar } };
    }
    for (const [provider, launcher, loaderPath] of [
        ['quilt', 'quilt-server-launch.jar', ['org', 'quiltmc', 'quilt-loader']],
        ['fabric', 'fabric-server-launch.jar', ['net', 'fabricmc', 'fabric-loader']],
    ] as const) {
        if (!jars.includes(launcher)) continue;
        const loader = newest(subdirs(path.join(serverDir, 'libraries', ...loaderPath))) ?? 'unknown';
        const mc = exists(serverDir, 'server.jar') ? jarVersion(path.join(serverDir, 'server.jar')) : null;
        return { provider, mcVersion: mc ?? world, releaseId: loader, launch: { jar: launcher } };
    }

    // Arclight (Bukkit on Forge/NeoForge/Fabric)
    const arclight = jars.find(j => /^arclight/i.test(j));
    if (arclight) {
        const mc = arclight.match(/^arclight-\w+-(\d[\d.]*\d)-/i)?.[1] ?? null;
        return { provider: 'arclight', mcVersion: mc ?? world, releaseId: 'unknown', launch: { jar: arclight } };
    }

    // Paper family: Purpur and Paper also keep spigot.yml, so check the most specific first.
    const history = readJson(path.join(serverDir, 'version_history.json'))?.currentVersion;
    const historyText = typeof history === 'string' ? history : '';
    const flavor = exists(serverDir, 'purpur.yml') || /purpur/i.test(historyText) ? 'purpur'
        : exists(serverDir, 'config', 'paper-global.yml') || exists(serverDir, 'paper.yml') || /paper/i.test(historyText) ? 'paper'
        : exists(serverDir, 'spigot.yml') ? 'spigot'
        : null;
    if (flavor) {
        const jar = pickJar(serverDir, /paper|purpur|spigot|bukkit/i);
        if (jar) {
            const mc = historyText.match(/\(MC: ([^)]+)\)/)?.[1] ?? jarVersion(path.join(serverDir, jar)) ?? world;
            // "26.1.2-74-e4e17fc (MC: 26.1.2)" or the older "git-Paper-123 (MC: 1.21.4)"
            const build = historyText.match(/^[\d.]+-(\d+)-/)?.[1] ?? historyText.match(/git-\w+-(\d+)/)?.[1];
            return { provider: flavor, mcVersion: mc, releaseId: build ?? 'unknown', launch: { jar } };
        }
    }

    // Vanilla, or anything else that runs from a single jar
    const jar = pickJar(serverDir);
    if (jar) {
        const mc = jarVersion(path.join(serverDir, jar)) ?? world;
        return { provider: mc && isSnapshot(mc) ? 'snapshot' : 'vanilla', mcVersion: mc, releaseId: mc ?? 'unknown', launch: { jar } };
    }
    return null;
}

/** Set server-port in server.properties (RamsCraft owns the port; everything else is left as it is). */
export function setServerPort(serverDir: string, port: number): void {
    const file = path.join(serverDir, 'server.properties');
    let lines: string[] = [];
    try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { /* no properties yet */ }
    const line = `server-port=${port}`;
    const i = lines.findIndex(l => l.startsWith('server-port='));
    if (i >= 0) lines[i] = line;
    else lines.splice(lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length, 0, line);
    fs.writeFileSync(file, lines.join('\n').replace(/\n?$/, '\n'));
}
