import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useDialog } from '../../components/Dialog';
import {
    ArrowLeft, Ban, Bed, ChartBar, Crown, Database, Drumstick, Heart, LayoutGrid, MapPin,
    Pencil, RefreshCw, RotateCcw, Save, Shield, ShieldCheck, Skull, Swords, UtensilsCrossed, X,
} from 'lucide-react';
import {
    PlayerAvatar, ServerStoppedNotice, formatDate, notify, runPlayerCommand,
} from './Players';

// ---------------------------------------------------------------- formatting

const GAME_MODES = ['Survival', 'Creative', 'Adventure', 'Spectator'];
const DIMENSIONS: Record<string, string> = {
    'minecraft:overworld': 'Overworld',
    'minecraft:the_nether': 'The Nether',
    'minecraft:the_end': 'The End',
};

const pretty = (id: string) => id.replace(/^minecraft:/, '').split(/[_./]/).filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

const dimensionName = (d: string | null | undefined) => d ? DIMENSIONS[d] ?? d : 'Unknown';

const formatDuration = (ticks: number) => {
    const s = Math.floor(ticks / 20);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
};

const num = (n: number, digits = 1) => n.toLocaleString(undefined, { maximumFractionDigits: digits });

// ---------------------------------------------------------------- statistics model (Minecraft's stats JSON)

const CUSTOM = 'minecraft:custom';
const GENERAL_KEYS = ['minecraft:play_time', 'minecraft:player_kills', 'minecraft:deaths'];
// Always listed (as 0 when absent), in the order Minecraft's statistics screen uses.
const DISTANCE_KEYS = [
    'minecraft:walk_one_cm', 'minecraft:sprint_one_cm', 'minecraft:aviate_one_cm', 'minecraft:boat_one_cm',
    'minecraft:fall_one_cm', 'minecraft:horse_one_cm', 'minecraft:swim_one_cm', 'minecraft:crouch_one_cm',
    'minecraft:walk_under_water_one_cm', 'minecraft:walk_on_water_one_cm', 'minecraft:climb_one_cm', 'minecraft:strider_one_cm',
];
const LABELS: Record<string, string> = {
    'minecraft:play_time': 'Playtime',
    'minecraft:player_kills': 'Player Kills',
    'minecraft:deaths': 'Deaths',
    'minecraft:walk_one_cm': 'Distance Walked',
    'minecraft:sprint_one_cm': 'Distance Sprinted',
    'minecraft:aviate_one_cm': 'Distance by Elytra',
    'minecraft:boat_one_cm': 'Distance by Boat',
    'minecraft:fall_one_cm': 'Distance Fallen',
    'minecraft:horse_one_cm': 'Distance by Horse',
    'minecraft:swim_one_cm': 'Distance Swum',
    'minecraft:crouch_one_cm': 'Distance Crouched',
    'minecraft:walk_under_water_one_cm': 'Distance Walked under Water',
    'minecraft:walk_on_water_one_cm': 'Distance Walked on Water',
    'minecraft:climb_one_cm': 'Distance Climbed',
    'minecraft:strider_one_cm': 'Distance by Strider',
    'minecraft:minecart_one_cm': 'Distance by Minecart',
    'minecraft:pig_one_cm': 'Distance by Pig',
    'minecraft:fly_one_cm': 'Distance Flown',
    'minecraft:happy_ghast_one_cm': 'Distance by Happy Ghast',
};
const CATEGORY_LABELS: Record<string, string> = {
    'minecraft:mined': 'Blocks Broken',
    'minecraft:used': 'Items Used',
    'minecraft:killed': 'Entities Killed',
    'minecraft:killed_by': 'Killed By',
    'minecraft:crafted': 'Items Crafted',
    'minecraft:broken': 'Tools Broken',
    'minecraft:picked_up': 'Items Picked Up',
    'minecraft:dropped': 'Items Dropped',
};
const TIME_KEYS = new Set(['minecraft:play_time', 'minecraft:total_world_time', 'minecraft:time_since_death', 'minecraft:time_since_rest', 'minecraft:sneak_time']);

type Unit = 'distance' | 'time' | 'damage' | 'count';
const unitOf = (category: string, key: string): Unit => category !== CUSTOM ? 'count'
    : key.endsWith('_one_cm') ? 'distance' : TIME_KEYS.has(key) ? 'time' : key.startsWith('minecraft:damage_') ? 'damage' : 'count';

// Stored units: distance in cm, time in ticks, damage in tenths. Edits use the displayed unit.
const FACTOR: Record<Unit, number> = { distance: 100, time: 20, damage: 10, count: 1 };
const EDIT_UNIT: Record<Unit, string> = { distance: 'blocks', time: 'seconds', damage: 'HP', count: '' };

const formatStat = (unit: Unit, v: number) =>
    unit === 'distance' ? `${num(v / 100)} blocks`
        : unit === 'time' ? formatDuration(v)
            : unit === 'damage' ? `${num(v / 10)} HP`
                : v.toLocaleString();

const statLabel = (key: string) => LABELS[key] ?? pretty(key);

// ---------------------------------------------------------------- small UI pieces

const Card = ({ title, icon, actions, children }: { title: string; icon?: ReactNode; actions?: ReactNode; children: ReactNode }) => (
    <div className="glass-panel rounded-xl overflow-hidden">
        <div className="p-5 border-b border-white/[0.04] bg-white/[0.02] flex items-center justify-between gap-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">{icon}{title}</h3>
            {actions}
        </div>
        {children}
    </div>
);

const Tile = ({ label, value }: { label: string; value: ReactNode }) => (
    <div className="bg-black/20 border border-white/5 rounded-lg p-4">
        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</div>
        <div className="text-white font-semibold">{value}</div>
    </div>
);

const StatusBadge = ({ online }: { online: boolean }) => online
    ? <span className="bg-[#2ed573]/15 text-[#2ed573] text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase">ONLINE</span>
    : <span className="bg-[#ff4757]/15 text-[#ff4757] text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase">OFFLINE</span>;

const TABS = [
    { key: 'overview', label: 'Overview', icon: <LayoutGrid size={16} /> },
    { key: 'actions', label: 'Actions', icon: <Swords size={16} /> },
    { key: 'permissions', label: 'Permissions', icon: <Shield size={16} /> },
    { key: 'locations', label: 'Locations', icon: <MapPin size={16} /> },
    { key: 'statistics', label: 'Statistics', icon: <ChartBar size={16} /> },
    { key: 'data', label: 'Player Data', icon: <Database size={16} /> },
] as const;
type TabKey = typeof TABS[number]['key'];

// ---------------------------------------------------------------- page

export const PlayerDetail = () => {
    const { id, uuid } = useParams();
    const [player, setPlayer] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<TabKey>('overview');

    const load = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`/api/servers/${id}/players/${uuid}`);
            setPlayer(res.data);
            setError(null);
        } catch (e: any) {
            const message = e.response?.data?.error || e.message;
            setError(message);
            if (player) toast.error(message); // first load shows the error in the page instead
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, [id, uuid]);

    const backLink = (
        <Link to={`/server/${id}/players`} className="glass-button px-3 py-2 inline-flex items-center gap-2">
            <ArrowLeft size={16} /> Players
        </Link>
    );

    if (!player) {
        return (
            <div className="max-w-5xl space-y-6">
                {backLink}
                <div className="glass-panel rounded-xl p-12 text-center text-slate-400 font-medium">
                    {error ? error : 'Loading player...'}
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-5xl space-y-6">
            <div className="glass-panel rounded-xl p-6 space-y-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-4">
                        <PlayerAvatar name={player.name} size={56} />
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <h2 className="text-2xl font-bold text-white tracking-tight">{player.name || 'Unknown name'}</h2>
                                <StatusBadge online={player.online} />
                            </div>
                            <p className="text-xs text-slate-500 font-mono">{player.uuid}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {backLink}
                        <button onClick={load} disabled={loading} className="glass-button px-3 py-2 inline-flex items-center gap-2">
                            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
                        </button>
                    </div>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                    {TABS.map(t => (
                        <button key={t.key} onClick={() => setTab(t.key)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all shrink-0 ${tab === t.key
                                ? 'bg-white/10 text-white shadow-sm border border-white/10'
                                : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'}`}>
                            {t.icon}{t.label}
                        </button>
                    ))}
                </div>
            </div>

            {tab === 'overview' && <Overview player={player} />}
            {tab === 'actions' && <Actions serverId={id!} player={player} />}
            {tab === 'permissions' && <Permissions serverId={id!} player={player} onChanged={load} />}
            {tab === 'locations' && <Locations player={player} />}
            {tab === 'statistics' && <Statistics serverId={id!} player={player} onSaved={load} />}
            {tab === 'data' && <PlayerData player={player} />}
        </div>
    );
};

// ---------------------------------------------------------------- tabs

const savedNote = (player: any) => player.online
    ? 'Player data was saved from the running server when this page loaded.'
    : `Saved player data from ${formatDate(player.dataSavedAt)}.`;

const Overview = ({ player }: { player: any }) => {
    const d = player.data;
    const custom = player.stats?.[CUSTOM] ?? {};
    return (
        <Card title="Overview" icon={<LayoutGrid size={18} />}>
            <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Tile label="Status" value={player.online ? 'Online' : 'Offline'} />
                    <Tile label="Game Mode" value={d?.gameMode != null ? GAME_MODES[d.gameMode] ?? `Mode ${d.gameMode}` : 'Unknown'} />
                    <Tile label="Health" value={d?.health != null ? `${num(d.health)} / ${num(d.maxHealth)}` : 'Unknown'} />
                    <Tile label="Food" value={d?.food != null ? `${d.food} / 20` : 'Unknown'} />
                    <Tile label="XP Level" value={d?.xpLevel ?? 'Unknown'} />
                    <Tile label="Playtime" value={formatDuration(custom['minecraft:play_time'] ?? 0)} />
                    <Tile label="Deaths" value={(custom['minecraft:deaths'] ?? 0).toLocaleString()} />
                    <Tile label="Last Seen" value={player.online ? 'Now' : formatDate(d?.lastPlayed ?? player.dataSavedAt)} />
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                    <span className={`px-2 py-1 rounded border ${player.whitelisted ? 'bg-[#2ed573]/10 border-[#2ed573]/20 text-[#2ed573]' : 'bg-white/5 border-white/10 text-slate-400'}`}>{player.whitelisted ? 'Whitelisted' : 'Not whitelisted'}</span>
                    <span className={`px-2 py-1 rounded border ${player.op ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-white/5 border-white/10 text-slate-400'}`}>{player.op ? 'Operator' : 'Not an operator'}</span>
                    <span className={`px-2 py-1 rounded border ${player.banned ? 'bg-[#ff4757]/10 border-[#ff4757]/20 text-[#ff4757]' : 'bg-white/5 border-white/10 text-slate-400'}`}>{player.banned ? 'Banned' : 'Not banned'}</span>
                </div>
                <p className="text-xs text-slate-500">{d ? savedNote(player) : 'No player data file found yet.'} First joined: {formatDate(d?.firstPlayed)}.</p>
            </div>
        </Card>
    );
};

const ACTIONS = [
    { command: 'heal', label: 'Heal', icon: <Heart size={18} />, description: 'Restore full health with an Instant Health effect.', style: 'bg-[#2ed573]/10 text-[#2ed573] border-[#2ed573]/20 hover:bg-[#2ed573]/20' },
    { command: 'feed', label: 'Feed', icon: <Drumstick size={18} />, description: 'Fill hunger and saturation with a Saturation effect.', style: 'bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20' },
    { command: 'starve', label: 'Starve', icon: <UtensilsCrossed size={18} />, description: 'Drain hunger to zero over about 10 seconds with a Hunger effect. No effect in Creative or on Peaceful.', style: 'bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20', confirm: { tone: 'warning', text: 'Their hunger bar will drain to zero.' } },
    { command: 'kill', label: 'Kill', icon: <Skull size={18} />, description: 'Kill the player immediately. They drop their items unless keepInventory is on.', style: 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20', confirm: { tone: 'danger', text: 'They will die immediately and may lose their items.' } },
];

const Actions = ({ serverId, player }: { serverId: string; player: any }) => {
    const [busy, setBusy] = useState<string | null>(null);
    const { dialog, confirm } = useDialog();
    const available = player.online && !!player.name;

    const run = async (action: typeof ACTIONS[number]) => {
        if (action.confirm && !(await confirm({
            title: `${action.label} ${player.name}?`,
            message: action.confirm.text,
            confirmLabel: action.label,
            tone: action.confirm.tone as 'danger' | 'warning',
        }))) return;
        setBusy(action.command);
        notify(await runPlayerCommand(serverId, action.command, player.name));
        setBusy(null);
    };

    return (
        <Card title="Actions" icon={<Swords size={18} />}>
            <div className="p-6 space-y-4">
                {!available && <ServerStoppedNotice>{player.name || 'This player'} is offline. These actions run on a connected player, so they're only available while the player is online.</ServerStoppedNotice>}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {ACTIONS.map(a => (
                        <button key={a.command} onClick={() => run(a)} disabled={!available || busy !== null}
                            className={`glass-button ${a.style} p-4 flex items-start gap-3 text-left disabled:opacity-40 disabled:cursor-not-allowed`}>
                            <span className="mt-0.5">{a.icon}</span>
                            <span>
                                <span className="block font-semibold text-sm">{busy === a.command ? `${a.label}...` : a.label}</span>
                                <span className="block text-xs text-slate-400 font-normal mt-1">{a.description}</span>
                            </span>
                        </button>
                    ))}
                </div>
                {dialog}
            </div>
        </Card>
    );
};

const PERMISSIONS = [
    { flag: 'whitelisted', label: 'Whitelisted', icon: <ShieldCheck size={18} />, on: 'whitelist add', off: 'whitelist remove', onLabel: 'Add to whitelist', offLabel: 'Remove from whitelist' },
    { flag: 'op', label: 'Operator (OP)', icon: <Crown size={18} />, on: 'op', off: 'deop', onLabel: 'Make operator', offLabel: 'Remove operator' },
    { flag: 'banned', label: 'Banned', icon: <Ban size={18} />, on: 'ban', off: 'pardon', onLabel: 'Ban player', offLabel: 'Pardon player', confirm: 'They will be disconnected and unable to rejoin.' },
] as const;

const Permissions = ({ serverId, player, onChanged }: { serverId: string; player: any; onChanged: () => void }) => {
    const [busy, setBusy] = useState(false);
    const { dialog, confirm } = useDialog();
    const available = player.serverRunning && !!player.name;

    const toggle = async (p: typeof PERMISSIONS[number]) => {
        const enabled = player[p.flag];
        if (!enabled && 'confirm' in p && !(await confirm({
            title: `Ban ${player.name}?`,
            message: p.confirm,
            confirmLabel: 'Ban',
            tone: 'danger',
        }))) return;
        setBusy(true);
        notify(await runPlayerCommand(serverId, enabled ? p.off : p.on, player.name));
        await onChanged();
        setBusy(false);
    };

    return (
        <Card title="Permissions" icon={<Shield size={18} />}>
            <div className="p-6 space-y-4">
                {!player.serverRunning && <ServerStoppedNotice>The server is stopped. Permission changes go through the server console, so start the server to change them.</ServerStoppedNotice>}
                <div className="divide-y divide-white/[0.04] bg-black/20 border border-white/5 rounded-lg">
                    {PERMISSIONS.map(p => {
                        const enabled = !!player[p.flag];
                        const danger = p.flag === 'banned' && !enabled;
                        return (
                            <div key={p.flag} className="p-4 flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <span className="text-slate-400">{p.icon}</span>
                                    <div>
                                        <div className="text-white font-medium text-sm">{p.label}</div>
                                        <div className={`text-xs ${enabled ? (p.flag === 'banned' ? 'text-[#ff4757]' : 'text-[#2ed573]') : 'text-slate-500'}`}>{enabled ? 'Yes' : 'No'}</div>
                                    </div>
                                </div>
                                <button onClick={() => toggle(p)} disabled={!available || busy}
                                    className={`glass-button px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed ${danger ? 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20' : ''}`}>
                                    {enabled ? p.offLabel : p.onLabel}
                                </button>
                            </div>
                        );
                    })}
                </div>
                {dialog}
            </div>
        </Card>
    );
};

const LocationCard = ({ title, icon, loc, decimals, empty }: { title: string; icon: ReactNode; loc: any; decimals: number; empty: string }) => (
    <div className="bg-black/20 border border-white/5 rounded-lg p-5">
        <div className="flex items-center gap-2 text-white font-semibold text-sm mb-4">{icon}{title}</div>
        {loc?.pos ? (
            <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                    {['X', 'Y', 'Z'].map((axis, i) => (
                        <div key={axis} className="bg-black/30 rounded-md px-3 py-2">
                            <div className="text-[10px] font-semibold text-slate-500">{axis}</div>
                            <div className="text-white font-mono text-sm">{Number(loc.pos[i]).toFixed(decimals)}</div>
                        </div>
                    ))}
                </div>
                <div className="text-xs text-slate-400">Dimension: <span className="text-slate-200">{dimensionName(loc.dimension)}</span></div>
            </div>
        ) : (
            <p className="text-sm text-slate-500">{empty}</p>
        )}
    </div>
);

const Locations = ({ player }: { player: any }) => {
    const loc = player.location;
    return (
        <Card title="Locations" icon={<MapPin size={18} />}>
            <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <LocationCard title="Current Position" icon={<MapPin size={16} />} loc={loc?.current} decimals={1} empty="Unknown" />
                    <LocationCard title="Respawn Point" icon={<Bed size={16} />} loc={loc?.respawn} decimals={0} empty="Not set. The player respawns at the world spawn." />
                    <LocationCard title="Last Death" icon={<Skull size={16} />} loc={loc?.lastDeath} decimals={0} empty="Unknown. No death has been recorded." />
                </div>
                <p className="text-xs text-slate-500">{loc ? savedNote(player) : 'No player data file found yet.'}</p>
            </div>
        </Card>
    );
};

const StatList = ({ rows, editing, edits, setEdit }: {
    rows: { category: string; key: string; value: number; readOnly?: boolean; label?: string; display?: string }[];
    editing: boolean;
    edits: Record<string, string>;
    setEdit: (id: string, v: string) => void;
}) => (
    <div className="divide-y divide-white/[0.04]">
        {rows.map(r => {
            const id = `${r.category}|${r.key}`;
            const unit = unitOf(r.category, r.key);
            return (
                <div key={id} className="px-5 py-2.5 flex items-center justify-between gap-4 text-sm hover:bg-white/[0.02]">
                    <span className="text-slate-300">{r.label ?? statLabel(r.key)}</span>
                    {editing && !r.readOnly ? (
                        <span className="flex items-center gap-2">
                            <input type="number" min={0} step="any"
                                value={edits[id] ?? String(r.value / FACTOR[unit])}
                                onChange={e => setEdit(id, e.target.value)}
                                className="glass-input w-36 py-1 text-right text-sm" />
                            <span className="text-xs text-slate-500 w-12">{EDIT_UNIT[unit]}</span>
                            <button onClick={() => setEdit(id, '0')} title="Reset to 0" className="glass-button p-1.5"><RotateCcw size={14} /></button>
                        </span>
                    ) : (
                        <span className="text-white font-medium font-mono">{r.display ?? formatStat(unit, r.value)}</span>
                    )}
                </div>
            );
        })}
    </div>
);

const CategoryCard = ({ category, title, entries, ...list }: { category: string; title?: string; entries: [string, number][] } & Omit<Parameters<typeof StatList>[0], 'rows'>) => {
    const [showAll, setShowAll] = useState(false);
    const sorted = [...entries].sort((a, b) => b[1] - a[1]);
    const visible = showAll || list.editing ? sorted : sorted.slice(0, 15);
    return (
        <Card title={title ?? CATEGORY_LABELS[category] ?? pretty(category)}
            actions={<span className="text-xs text-slate-500">{entries.length} types</span>}>
            <div className="bg-black/20">
                <StatList {...list} rows={visible.map(([key, value]) => ({ category, key, value }))} />
                {sorted.length > visible.length && (
                    <button onClick={() => setShowAll(true)} className="w-full py-2.5 text-xs text-slate-400 hover:text-white border-t border-white/[0.04]">
                        Show all {sorted.length}
                    </button>
                )}
            </div>
        </Card>
    );
};

const Statistics = ({ serverId, player, onSaved }: { serverId: string; player: any; onSaved: () => void }) => {
    const [editing, setEditing] = useState(false);
    const [edits, setEdits] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const { dialog, confirm } = useDialog();
    const stats: Record<string, Record<string, number>> = player.stats ?? {};
    const custom = stats[CUSTOM] ?? {};

    if (!player.stats) {
        return <Card title="Statistics" icon={<ChartBar size={18} />}><p className="p-12 text-center text-slate-400 font-medium">No statistics file for this player yet.</p></Card>;
    }

    const setEdit = (id: string, v: string) => setEdits(prev => ({ ...prev, [id]: v }));
    const listProps = { editing, edits, setEdit };

    const kills = custom['minecraft:player_kills'] ?? 0;
    const deaths = custom['minecraft:deaths'] ?? 0;
    const distanceKeys = [...DISTANCE_KEYS, ...Object.keys(custom).filter(k => k.endsWith('_one_cm') && !DISTANCE_KEYS.includes(k))];
    const totalDistance = distanceKeys.reduce((sum, k) => sum + (custom[k] ?? 0), 0);
    const otherCustom = Object.keys(custom).filter(k => !GENERAL_KEYS.includes(k) && !k.endsWith('_one_cm'));
    const categories = Object.keys(stats).filter(c => c !== CUSTOM)
        .sort((a, b) => (Object.keys(CATEGORY_LABELS).indexOf(a) + 1 || 99) - (Object.keys(CATEGORY_LABELS).indexOf(b) + 1 || 99));

    const save = async () => {
        const changes: { category: string; key: string; value: number }[] = [];
        for (const [id, text] of Object.entries(edits)) {
            const [category, key] = id.split('|');
            const parsed = Number(text);
            if (text.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
                toast.error(`${statLabel(key)}: enter a number of 0 or more.`);
                return;
            }
            const value = Math.round(parsed * FACTOR[unitOf(category, key)]);
            if (value !== (stats[category]?.[key] ?? 0)) changes.push({ category, key, value });
        }
        if (changes.length === 0) {
            setEditing(false);
            setEdits({});
            return;
        }
        if (!(await confirm({
            title: 'Save Statistics',
            message: `Save ${changes.length} statistic change${changes.length === 1 ? '' : 's'} for ${player.name}? The previous file is kept as a .bak copy.`,
            confirmLabel: 'Save Changes',
            tone: 'warning',
        }))) return;
        setSaving(true);
        try {
            await axios.post(`/api/servers/${serverId}/players/${player.uuid}/stats`, { changes });
            toast.success(`Saved ${changes.length} statistic change${changes.length === 1 ? '' : 's'}.`);
            setEditing(false);
            setEdits({});
            onSaved();
        } catch (e: any) {
            toast.error(e.response?.data?.error || e.message);
        } finally {
            setSaving(false);
        }
    };

    const editActions = editing ? (
        <div className="flex gap-2">
            <button onClick={() => { setEditing(false); setEdits({}); }} className="glass-button px-3 py-2 inline-flex items-center gap-2"><X size={16} /> Cancel</button>
            <button onClick={save} disabled={saving} className="glass-button bg-blue-600/20 text-blue-400 border-blue-500/30 hover:bg-blue-600/30 hover:text-white px-4 py-2 inline-flex items-center gap-2">
                <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
            </button>
        </div>
    ) : (
        <button onClick={() => setEditing(true)} disabled={player.serverRunning}
            title={player.serverRunning ? 'Stop the server to edit statistics' : undefined}
            className="glass-button px-3 py-2 inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
            <Pencil size={16} /> Edit
        </button>
    );

    return (
        <div className="space-y-6">
            <Card title="Statistics" icon={<ChartBar size={18} />} actions={editActions}>
                <div className="p-5 space-y-3">
                    {player.serverRunning
                        ? <ServerStoppedNotice>Statistics are read-only while the server is running, because the server keeps its own copy and would overwrite edits. Stop the server to edit them.</ServerStoppedNotice>
                        : <p className="text-xs text-slate-500">Edits are written to the player's statistics file in Minecraft's own format. Setting a value to 0 removes it.</p>}
                    <p className="text-xs text-slate-500">{player.online ? 'Statistics were saved from the running server when this page loaded.' : `Last saved ${formatDate(player.statsSavedAt)}.`}</p>
                    {dialog}
                </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <Card title="General">
                    <div className="bg-black/20">
                        <StatList {...listProps} rows={[
                            ...GENERAL_KEYS.map(key => ({ category: CUSTOM, key, value: custom[key] ?? 0 })),
                            { category: CUSTOM, key: 'kdr', value: 0, readOnly: true, label: 'KDR', display: num(deaths ? kills / deaths : kills, 2) },
                        ]} />
                    </div>
                </Card>

                <Card title="Distance Travelled">
                    <div className="bg-black/20">
                        <StatList {...listProps} rows={[
                            { category: CUSTOM, key: 'total', value: totalDistance, readOnly: true, label: 'Total', display: formatStat('distance', totalDistance) },
                            ...distanceKeys.map(key => ({ category: CUSTOM, key, value: custom[key] ?? 0 })),
                        ]} />
                    </div>
                </Card>
            </div>

            {categories.map(c => <CategoryCard key={c} category={c} entries={Object.entries(stats[c])} {...listProps} />)}

            {otherCustom.length > 0 && <CategoryCard category={CUSTOM} title="Other Statistics" entries={otherCustom.map(k => [k, custom[k]] as [string, number])} {...listProps} />}
        </div>
    );
};

const PlayerData = ({ player }: { player: any }) => {
    const d = player.data;
    if (!d) return <Card title="Player Data" icon={<Database size={18} />}><p className="p-12 text-center text-slate-400 font-medium">No player data file for this player yet.</p></Card>;

    const fields: [string, ReactNode][] = [
        ['Health', d.health != null ? `${num(d.health)} / ${num(d.maxHealth)}` : 'Unknown'],
        ['Absorption', d.absorption != null ? num(d.absorption) : 'Unknown'],
        ['Food Level', d.food ?? 'Unknown'],
        ['Saturation', d.saturation != null ? num(d.saturation) : 'Unknown'],
        ['Exhaustion', d.exhaustion != null ? num(d.exhaustion, 2) : 'Unknown'],
        ['XP Level', d.xpLevel ?? 'Unknown'],
        ['Total XP', d.xpTotal ?? 'Unknown'],
        ['Level Progress', d.xpProgress != null ? `${Math.round(d.xpProgress * 100)}%` : 'Unknown'],
        ['Game Mode', d.gameMode != null ? GAME_MODES[d.gameMode] ?? d.gameMode : 'Unknown'],
        ['Air', d.air ?? 'Unknown'],
        ['Fire Ticks', d.fireTicks ?? 'Unknown'],
        ['Score', d.score ?? 'Unknown'],
        ['Flying', d.abilities ? (d.abilities.flying ? 'Yes' : 'No') : 'Unknown'],
        ['Can Fly', d.abilities ? (d.abilities.mayfly ? 'Yes' : 'No') : 'Unknown'],
        ['Invulnerable', d.abilities ? (d.abilities.invulnerable ? 'Yes' : 'No') : 'Unknown'],
        ['First Joined', formatDate(d.firstPlayed)],
        ['Last Played', formatDate(d.lastPlayed)],
        ['Data Version', d.dataVersion ?? 'Unknown'],
    ];

    const ItemTable = ({ title, items }: { title: string; items: any[] }) => (
        <Card title={title} actions={<span className="text-xs text-slate-500">{items.length} stacks</span>}>
            <div className="bg-black/20 max-h-96 overflow-y-auto">
                {items.length === 0 ? <p className="p-8 text-center text-slate-500 text-sm">Empty</p> : (
                    <table className="w-full text-left text-sm text-slate-300">
                        <thead className="bg-black/40 border-b border-white/[0.04]">
                            <tr>
                                <th className="px-5 py-2.5 font-semibold text-slate-400">Slot</th>
                                <th className="px-5 py-2.5 font-semibold text-slate-400">Item</th>
                                <th className="px-5 py-2.5 text-right font-semibold text-slate-400">Count</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                            {items.map((item, i) => (
                                <tr key={i}>
                                    <td className="px-5 py-2 text-slate-500 font-mono">{item.slot ?? '-'}</td>
                                    <td className="px-5 py-2 text-white">{pretty(item.id)}</td>
                                    <td className="px-5 py-2 text-right font-mono">{item.count}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </Card>
    );

    return (
        <div className="space-y-6">
            <Card title="Player Data" icon={<Database size={18} />}>
                <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {fields.map(([label, value]) => <Tile key={label} label={label} value={value} />)}
                    </div>
                    {d.effects.length > 0 && (
                        <div className="text-sm text-slate-300">
                            <span className="text-slate-500">Active effects: </span>
                            {d.effects.map((e: any) => `${pretty(e.id)} ${e.amplifier + 1} (${formatDuration(e.duration)})`).join(', ')}
                        </div>
                    )}
                    <p className="text-xs text-slate-500">
                        Read-only. {savedNote(player)} The player file is binary NBT owned by the server, so RamsCraft doesn't edit it: a mistake there can corrupt the player. Use the Actions tab for live changes.
                    </p>
                </div>
            </Card>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <ItemTable title="Inventory" items={d.inventory} />
                <ItemTable title="Ender Chest" items={d.enderChest} />
            </div>
        </div>
    );
};
