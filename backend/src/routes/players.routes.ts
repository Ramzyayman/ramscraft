import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { processService } from '../services/ProcessService';
import { prisma } from '../index';
import * as util from 'minecraft-server-util';
import { serverRoot, isInside } from '../utils/paths';
import { readNbt } from '../utils/nbt';

const router = Router();

const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IP_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$|^(?=.*:)[0-9a-f:]{2,39}$/i;

async function findServer(id: string) {
    const server = await prisma.server.findUnique({ where: { id } });
    return server ? { server, dir: serverRoot(server.directoryName) } : null;
}

function readJson<T>(file: string, fallback: T): T {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function readArray(file: string): any[] {
    const v = readJson<any>(file, []);
    return Array.isArray(v) ? v : [];
}

/** The world folder from level-name, kept inside the server directory. */
function worldDir(serverDir: string): string {
    let level = 'world';
    try {
        const line = fs.readFileSync(path.join(serverDir, 'server.properties'), 'utf8').split('\n').find(l => l.startsWith('level-name='));
        if (line) level = line.slice('level-name='.length).trim() || 'world';
    } catch { /* default */ }
    const dir = path.resolve(serverDir, level);
    return isInside(serverDir, dir) ? dir : path.join(serverDir, 'world');
}

/** Minecraft 26.1+ keeps player files in <world>/players/{data,stats}; older versions use playerdata/ and stats/. */
function playerDirs(serverDir: string) {
    const world = worldDir(serverDir);
    const modern = path.join(world, 'players');
    return fs.existsSync(modern)
        ? { data: path.join(modern, 'data'), stats: path.join(modern, 'stats') }
        : { data: path.join(world, 'playerdata'), stats: path.join(world, 'stats') };
}

const LIST_FILES = {
    whitelist: 'whitelist.json',
    ops: 'ops.json',
    bannedPlayers: 'banned-players.json',
    bannedIps: 'banned-ips.json',
} as const;

function readLists(serverDir: string) {
    return {
        whitelist: readArray(path.join(serverDir, LIST_FILES.whitelist)),
        ops: readArray(path.join(serverDir, LIST_FILES.ops)),
        bannedPlayers: readArray(path.join(serverDir, LIST_FILES.bannedPlayers)),
        bannedIps: readArray(path.join(serverDir, LIST_FILES.bannedIps)),
    };
}

function flagsFor(lists: ReturnType<typeof readLists>, uuid: string, name: string | null) {
    const has = (list: any[]) => list.some(e =>
        String(e.uuid || '').toLowerCase() === uuid || (!!name && String(e.name || '').toLowerCase() === name.toLowerCase()));
    return { whitelisted: has(lists.whitelist), op: has(lists.ops), banned: has(lists.bannedPlayers) };
}

// ponytail: the status ping's sample caps at 12 names and is empty with hide-online-players; use `list uuids` if that bites.
async function pingPlayers(port: number) {
    try {
        const result = await util.status('127.0.0.1', port, { timeout: 2000 });
        return { online: result.players.online, max: result.players.max, sample: result.players.sample || [] };
    } catch {
        return { online: 0, max: 0, sample: [] as { name: string; id: string }[] };
    }
}

const isInSample = (sample: { name: string; id: string }[], uuid: string, name: string | null) =>
    sample.some(s => String(s.id).toLowerCase() === uuid || (!!name && s.name === name));

function mtime(file: string): number | null {
    try { return fs.statSync(file).mtimeMs; } catch { return null; }
}

function readPlayerNbt(dataDir: string, uuid: string): Record<string, any> | null {
    try { return readNbt(fs.readFileSync(path.join(dataDir, `${uuid}.dat`))); } catch { return null; }
}

router.get('/:id/players', async (req, res) => {
    const found = await findServer(req.params.id);
    if (!found) return res.status(404).json({ error: 'Server not found' });
    res.json(await pingPlayers(found.server.port));
});

router.get('/:id/players/lists', async (req, res) => {
    try {
        const found = await findServer(req.params.id);
        if (!found) return res.status(404).json({ error: 'Server not found' });
        res.json({ running: await processService.hasSession(found.server.id), ...readLists(found.dir) });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/** Every player with saved data (i.e. has joined), with online state and list flags. */
router.get('/:id/players/known', async (req, res) => {
    try {
        const found = await findServer(req.params.id);
        if (!found) return res.status(404).json({ error: 'Server not found' });
        const dirs = playerDirs(found.dir);
        const cache = readArray(path.join(found.dir, 'usercache.json'));
        const cachedNames = new Map(cache.map(e => [String(e.uuid).toLowerCase(), String(e.name)]));
        const lists = readLists(found.dir);
        const { sample } = await pingPlayers(found.server.port);

        const uuids = new Set<string>();
        for (const dir of [dirs.data, dirs.stats]) {
            let files: string[] = [];
            try { files = fs.readdirSync(dir); } catch { continue; }
            for (const f of files) {
                const m = f.match(/^([0-9a-f-]{36})\.(dat|json)$/i);
                if (m && UUID_RE.test(m[1])) uuids.add(m[1].toLowerCase());
            }
        }

        const players = [...uuids].map(uuid => {
            const name = cachedNames.get(uuid) ?? readPlayerNbt(dirs.data, uuid)?.bukkit?.lastKnownName ?? null;
            return {
                uuid,
                name,
                online: isInSample(sample, uuid, name),
                lastSeen: mtime(path.join(dirs.data, `${uuid}.dat`)) ?? mtime(path.join(dirs.stats, `${uuid}.json`)),
                ...flagsFor(lists, uuid, name),
            };
        }).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));

        res.json({ running: await processService.hasSession(found.server.id), players });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// `save-all` makes an online player's .dat and stats current before reading them.
// ponytail: whole-world save, throttled per server; switch to `data get entity` per field if saves cause lag.
const lastSaveAt = new Map<string, number>();
async function saveIfStale(serverId: string) {
    if (Date.now() - (lastSaveAt.get(serverId) ?? 0) < 15_000) return;
    lastSaveAt.set(serverId, Date.now());
    await processService.sendCommandCapture(serverId, 'save-all', { until: /Saved the game/ });
}

const vec3 = (v: any): number[] | null => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number') ? v : null;

function locationsFrom(nbt: Record<string, any>) {
    // 1.21.5+ stores `respawn: {pos, dimension}`; older versions use SpawnX/Y/Z + SpawnDimension.
    const respawn = nbt.respawn
        ? { pos: vec3(nbt.respawn.pos), dimension: nbt.respawn.dimension ?? null }
        : nbt.SpawnX !== undefined
            ? { pos: [nbt.SpawnX, nbt.SpawnY, nbt.SpawnZ], dimension: nbt.SpawnDimension ?? null }
            : null;
    return {
        current: { pos: vec3(nbt.Pos), dimension: typeof nbt.Dimension === 'string' ? nbt.Dimension : null },
        respawn,
        lastDeath: nbt.LastDeathLocation ? { pos: vec3(nbt.LastDeathLocation.pos), dimension: nbt.LastDeathLocation.dimension ?? null } : null,
    };
}

function playerDataFrom(nbt: Record<string, any>) {
    const items = (list: any) => Array.isArray(list)
        ? list.map((i: any) => ({ slot: i.Slot ?? null, id: String(i.id ?? 'unknown'), count: i.count ?? i.Count ?? 1 }))
        : [];
    const maxHealth = Array.isArray(nbt.attributes)
        ? nbt.attributes.find((a: any) => a.id === 'minecraft:max_health')?.base ?? 20
        : 20;
    return {
        health: nbt.Health ?? null,
        maxHealth,
        absorption: nbt.AbsorptionAmount ?? null,
        food: nbt.foodLevel ?? null,
        saturation: nbt.foodSaturationLevel ?? null,
        exhaustion: nbt.foodExhaustionLevel ?? null,
        xpLevel: nbt.XpLevel ?? null,
        xpTotal: nbt.XpTotal ?? null,
        xpProgress: nbt.XpP ?? null,
        gameMode: nbt.playerGameType ?? null,
        air: nbt.Air ?? null,
        fireTicks: nbt.Fire ?? null,
        score: nbt.Score ?? null,
        selectedSlot: nbt.SelectedItemSlot ?? null,
        abilities: nbt.abilities ?? null,
        firstPlayed: nbt.bukkit?.firstPlayed ?? null,
        lastPlayed: nbt.Paper?.LastSeen ?? nbt.bukkit?.lastPlayed ?? null,
        dataVersion: nbt.DataVersion ?? null,
        effects: Array.isArray(nbt.active_effects)
            ? nbt.active_effects.map((e: any) => ({ id: e.id, amplifier: e.amplifier ?? 0, duration: e.duration ?? 0 }))
            : [],
        inventory: items(nbt.Inventory),
        enderChest: items(nbt.EnderItems),
    };
}

router.get('/:id/players/:uuid', async (req, res) => {
    try {
        const uuid = req.params.uuid.toLowerCase();
        if (!UUID_RE.test(uuid)) return res.status(400).json({ error: 'Invalid player UUID' });
        const found = await findServer(req.params.id);
        if (!found) return res.status(404).json({ error: 'Server not found' });

        const running = await processService.hasSession(found.server.id);
        const { sample } = await pingPlayers(found.server.port);
        const cache = readArray(path.join(found.dir, 'usercache.json'));
        const sampleName = sample.find(s => String(s.id).toLowerCase() === uuid)?.name ?? null;
        let name: string | null = cache.find(e => String(e.uuid).toLowerCase() === uuid)?.name ?? sampleName;
        const online = running && isInSample(sample, uuid, name);
        if (online) await saveIfStale(found.server.id);

        const dirs = playerDirs(found.dir);
        const dataFile = path.join(dirs.data, `${uuid}.dat`);
        const statsFile = path.join(dirs.stats, `${uuid}.json`);
        const nbt = readPlayerNbt(dirs.data, uuid);
        const statsDoc = readJson<any>(statsFile, null);
        name = name ?? nbt?.bukkit?.lastKnownName ?? null;

        if (!nbt && !statsDoc && !online) return res.status(404).json({ error: 'No saved data for this player on this server' });

        res.json({
            uuid,
            name,
            online,
            serverRunning: running,
            ...flagsFor(readLists(found.dir), uuid, name),
            dataSavedAt: mtime(dataFile),
            statsSavedAt: mtime(statsFile),
            location: nbt ? locationsFrom(nbt) : null,
            data: nbt ? playerDataFrom(nbt) : null,
            stats: statsDoc && typeof statsDoc.stats === 'object' ? statsDoc.stats : null,
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

const STAT_ID_RE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

/**
 * Edit a player's statistics file. Only while the server is stopped: a running
 * server holds its own copy and would overwrite the file on its next save. The
 * JSON layout is Minecraft's own ({stats: {category: {key: int}}, DataVersion});
 * a value of 0 removes the entry, the previous file is kept as <uuid>.json.bak.
 */
router.post('/:id/players/:uuid/stats', async (req, res) => {
    try {
        const uuid = req.params.uuid.toLowerCase();
        if (!UUID_RE.test(uuid)) return res.status(400).json({ error: 'Invalid player UUID' });
        const found = await findServer(req.params.id);
        if (!found) return res.status(404).json({ error: 'Server not found' });
        if (await processService.hasSession(found.server.id)) {
            return res.status(409).json({ error: 'Stop the server before editing statistics. A running server would overwrite the changes on its next save.' });
        }

        const changes = req.body?.changes;
        if (!Array.isArray(changes) || changes.length === 0 || changes.length > 1000) {
            return res.status(400).json({ error: 'Provide 1-1000 changes' });
        }
        for (const c of changes) {
            if (!c || !STAT_ID_RE.test(c.category) || !STAT_ID_RE.test(c.key)
                || !Number.isInteger(c.value) || c.value < 0 || c.value > 2_147_483_647) {
                return res.status(400).json({ error: `Invalid change: ${JSON.stringify(c)}` });
            }
        }

        const file = path.join(playerDirs(found.dir).stats, `${uuid}.json`);
        let raw = '';
        try { raw = fs.readFileSync(file, 'utf8'); } catch { /* handled below */ }
        const doc = readJson<any>(file, null);
        if (!doc || typeof doc.stats !== 'object' || doc.stats === null) {
            return res.status(404).json({ error: 'This player has no statistics file yet' });
        }

        for (const { category, key, value } of changes) {
            if (value === 0) {
                if (doc.stats[category]) delete doc.stats[category][key];
            } else {
                doc.stats[category] = doc.stats[category] || {};
                doc.stats[category][key] = value;
            }
            if (doc.stats[category] && Object.keys(doc.stats[category]).length === 0) delete doc.stats[category];
        }

        fs.copyFileSync(file, `${file}.bak`);
        const tmp = `${file}.tmp`;
        // Keep the server's formatting (Minecraft pretty-prints with 2 spaces).
        fs.writeFileSync(tmp, raw.includes('\n') ? JSON.stringify(doc, null, 2) : JSON.stringify(doc));
        fs.renameSync(tmp, file);
        res.json({ success: true, stats: doc.stats });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// UI action -> console command. The target is validated for its kind before use.
// There are no vanilla heal/feed/starve commands, so those apply instant effects server-side.
const COMMANDS: Record<string, { kind: 'player' | 'ip'; build: (target: string) => string }> = {
    'kick': { kind: 'player', build: t => `kick ${t}` },
    'ban': { kind: 'player', build: t => `ban ${t}` },
    'pardon': { kind: 'player', build: t => `pardon ${t}` },
    'op': { kind: 'player', build: t => `op ${t}` },
    'deop': { kind: 'player', build: t => `deop ${t}` },
    'whitelist add': { kind: 'player', build: t => `whitelist add ${t}` },
    'whitelist remove': { kind: 'player', build: t => `whitelist remove ${t}` },
    'ban-ip': { kind: 'ip', build: t => `ban-ip ${t}` },
    'pardon-ip': { kind: 'ip', build: t => `pardon-ip ${t}` },
    'kill': { kind: 'player', build: t => `kill ${t}` },
    // Instant Health heals 4 << amplifier HP; amplifiers above 28 overflow into damage.
    'heal': { kind: 'player', build: t => `effect give ${t} minecraft:instant_health 1 10 true` },
    'feed': { kind: 'player', build: t => `effect give ${t} minecraft:saturation 1 10 true` },
    // Hunger 255 drains food and saturation to zero within ~10s (not in Creative/Peaceful).
    'starve': { kind: 'player', build: t => `effect give ${t} minecraft:hunger 10 255 true` },
};

router.post('/:id/players/command', async (req, res) => {
    try {
        const { command } = req.body;
        const target = req.body.target ?? req.body.player;
        const spec = typeof command === 'string' ? COMMANDS[command] : undefined;
        if (!spec) return res.status(400).json({ error: 'Unsupported command' });
        if (typeof target !== 'string' || !(spec.kind === 'ip' ? IP_RE : NAME_RE).test(target)) {
            return res.status(400).json({ error: spec.kind === 'ip' ? 'Invalid IP address' : 'Invalid player name' });
        }
        const output = await processService.sendCommandCapture(req.params.id, spec.build(target));
        res.json({ success: true, output });
    } catch (e: any) {
        res.status(e.message === 'Server is not running' ? 409 : 500).json({ error: e.message });
    }
});

export default router;
