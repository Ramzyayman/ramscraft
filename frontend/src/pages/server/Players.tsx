import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useDialog } from '../../components/Dialog';
import { Ban, ChevronRight, Crown, Globe, Plus, RefreshCw, ShieldCheck, TriangleAlert, Users, X } from 'lucide-react';

// ---------------------------------------------------------------- shared helpers (also used by PlayerDetail)

export const PlayerAvatar = ({ name, size = 32 }: { name: string | null; size?: number }) => (
    <img
        src={`https://minotar.net/avatar/${name || 'MHF_Steve'}/${size}`}
        alt={name || 'Unknown player'}
        style={{ width: size, height: size }}
        className="rounded-md bg-black/50 border border-white/10 shrink-0"
        onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
    />
);

// Minecraft replies that mean the command did nothing.
const FAILURE_RE = /no (player|entity) was found|unknown or incomplete|incorrect argument|invalid|could not|does not exist|nothing changed|not whitelisted|isn't|is not|must be/i;

export interface CommandResult { ok: boolean; message: string }

/** Run an allow-listed player command through the server console and report what the server said. */
export async function runPlayerCommand(serverId: string, command: string, target: string): Promise<CommandResult> {
    try {
        const res = await axios.post(`/api/servers/${serverId}/players/command`, { command, target });
        const output: string[] = res.data.output || [];
        const message = output.join(' · ') || 'Command sent. The server printed no reply.';
        return { ok: !FAILURE_RE.test(message), message };
    } catch (e: any) {
        return { ok: false, message: e.response?.data?.error || e.message };
    }
}

export const formatDate = (ms: number | null | undefined) => ms ? new Date(ms).toLocaleString() : 'Unknown';

/** Show a command result as the app's success/error toast. */
export const notify = (result: CommandResult) => result.ok ? toast.success(result.message) : toast.error(result.message);

export const ServerStoppedNotice = ({ children }: { children: ReactNode }) => (
    <div className="flex items-start gap-3 px-4 py-3 rounded-lg border bg-amber-500/10 border-amber-500/20 text-amber-300 text-sm">
        <TriangleAlert size={16} className="mt-0.5 shrink-0" />
        <span>{children}</span>
    </div>
);

// ---------------------------------------------------------------- list manager

type ListKey = 'whitelist' | 'ops' | 'bannedPlayers' | 'bannedIps';

const LISTS: Record<ListKey, { label: string; icon: ReactNode; add: string; remove: string; kind: 'player' | 'ip'; destructive?: boolean }> = {
    whitelist: { label: 'Whitelist', icon: <ShieldCheck size={16} />, add: 'whitelist add', remove: 'whitelist remove', kind: 'player' },
    ops: { label: 'OPs', icon: <Crown size={16} />, add: 'op', remove: 'deop', kind: 'player' },
    bannedPlayers: { label: 'Banned Players', icon: <Ban size={16} />, add: 'ban', remove: 'pardon', kind: 'player', destructive: true },
    bannedIps: { label: 'Banned IPs', icon: <Globe size={16} />, add: 'ban-ip', remove: 'pardon-ip', kind: 'ip', destructive: true },
};

const ListManager = ({ serverId, listKey, onClose, onChanged }: { serverId: string; listKey: ListKey; onClose: () => void; onChanged: () => void }) => {
    const list = LISTS[listKey];
    const [entries, setEntries] = useState<any[]>([]);
    const [running, setRunning] = useState(false);
    const [loading, setLoading] = useState(true);
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    const { dialog, confirm } = useDialog();

    const load = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`/api/servers/${serverId}/players/lists`);
            setEntries(res.data[listKey]);
            setRunning(res.data.running);
        } catch (e: any) {
            toast.error(e.response?.data?.error || 'Failed to load list');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, [serverId, listKey]);

    const run = async (command: string, target: string) => {
        setBusy(true);
        notify(await runPlayerCommand(serverId, command, target));
        await load();
        onChanged();
        setBusy(false);
    };

    const add = async (e: FormEvent) => {
        e.preventDefault();
        const target = value.trim();
        if (!target) return;
        if (list.destructive && !(await confirm({
            title: list.kind === 'ip' ? 'Ban IP Address' : 'Ban Player',
            message: <>Ban <span className="font-semibold text-white">{target}</span>? {list.kind === 'ip' ? 'Anyone connecting from this IP will be disconnected and blocked.' : 'They will be disconnected and unable to rejoin.'}</>,
            confirmLabel: 'Ban',
            tone: 'danger',
        }))) return;
        await run(list.add, target);
        setValue('');
    };

    const entryKey = (entry: any) => list.kind === 'ip' ? entry.ip : entry.name;

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            {dialog}
            <div className="glass-panel rounded-xl overflow-hidden w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-white/[0.04] bg-white/[0.02] flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">{list.icon}{list.label}</h3>
                        <p className="text-sm text-slate-400 mt-1">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={load} disabled={loading} className="glass-button p-2" title="Refresh"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
                        <button onClick={onClose} className="glass-button p-2" title="Close"><X size={16} /></button>
                    </div>
                </div>

                <div className="p-5 space-y-3 border-b border-white/[0.04]">
                    {!running && <ServerStoppedNotice>The server is stopped. Changes are applied through the server console, so start the server to add or remove entries.</ServerStoppedNotice>}
                    <form onSubmit={add} className="flex gap-2">
                        <input
                            value={value}
                            onChange={e => setValue(e.target.value)}
                            placeholder={list.kind === 'ip' ? 'IP address, e.g. 203.0.113.7' : 'Player name'}
                            className="flex-1 glass-input text-sm"
                            disabled={!running || busy}
                        />
                        <button type="submit" disabled={!running || busy || !value.trim()}
                            className="glass-button bg-blue-600/20 text-blue-400 border-blue-500/30 hover:bg-blue-600/30 hover:text-white px-4 py-2 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                            <Plus size={16} /> Add
                        </button>
                    </form>
                </div>

                <div className="bg-black/20 overflow-y-auto">
                    {entries.length === 0 ? (
                        <p className="p-10 text-center text-slate-400 font-medium">{loading ? 'Loading...' : 'This list is empty.'}</p>
                    ) : (
                        <table className="w-full text-left text-sm text-slate-300">
                            <thead className="bg-black/40 border-b border-white/[0.04]">
                                <tr>
                                    <th className="px-6 py-3 font-semibold text-slate-400">{list.kind === 'ip' ? 'IP Address' : 'Player'}</th>
                                    <th className="px-6 py-3 font-semibold text-slate-400">Details</th>
                                    <th className="px-6 py-3 text-right font-semibold text-slate-400">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.04]">
                                {entries.map((entry, i) => (
                                    <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                                        <td className="px-6 py-3">
                                            <div className="flex items-center gap-3">
                                                {list.kind === 'player' && <PlayerAvatar name={entry.name} size={24} />}
                                                <span className="font-semibold text-white">{entryKey(entry) || 'Unknown'}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-3 text-xs text-slate-400">
                                            {listKey === 'ops' && <>Level {entry.level ?? '?'}{entry.bypassesPlayerLimit ? ' · bypasses player limit' : ''}</>}
                                            {listKey === 'whitelist' && <span className="font-mono">{entry.uuid}</span>}
                                            {list.destructive && <>{entry.reason || 'No reason'}{entry.expires && entry.expires !== 'forever' ? ` · until ${entry.expires}` : ''}{entry.source ? ` · by ${entry.source}` : ''}</>}
                                        </td>
                                        <td className="px-6 py-3 text-right">
                                            <button
                                                onClick={() => run(list.remove, entryKey(entry))}
                                                disabled={!running || busy || !entryKey(entry)}
                                                className="glass-button px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                                                {list.destructive ? 'Pardon' : 'Remove'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

// ---------------------------------------------------------------- page

const FlagBadges = ({ p }: { p: { op?: boolean; whitelisted?: boolean; banned?: boolean } }) => (
    <div className="flex gap-1.5">
        {p.op && <span className="bg-blue-500/15 text-blue-400 text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase">OP</span>}
        {p.whitelisted && <span className="bg-[#2ed573]/15 text-[#2ed573] text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase">Whitelisted</span>}
        {p.banned && <span className="bg-[#ff4757]/15 text-[#ff4757] text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase">Banned</span>}
    </div>
);

export const Players = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [players, setPlayers] = useState<any[]>([]);
    const [onlineCount, setOnlineCount] = useState(0);
    const [maxCount, setMaxCount] = useState(0);
    const [known, setKnown] = useState<any[]>([]);
    const [openList, setOpenList] = useState<ListKey | null>(null);
    const { dialog, confirm } = useDialog();

    const fetchPlayers = async () => {
        try {
            const res = await axios.get(`/api/servers/${id}/players`);
            setOnlineCount(res.data.online);
            setMaxCount(res.data.max);
            setPlayers(res.data.sample);
        } catch (e) {
            console.error(e);
        }
    };

    const fetchKnown = async () => {
        try {
            const res = await axios.get(`/api/servers/${id}/players/known`);
            setKnown(res.data.players);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        fetchPlayers();
        fetchKnown();
        const intv = setInterval(() => { fetchPlayers(); fetchKnown(); }, 5000);
        return () => clearInterval(intv);
    }, [id]);

    const executeCommand = async (command: string, player: string) => {
        if (command === 'ban' && !(await confirm({
            title: 'Ban Player',
            message: <>Ban <span className="font-semibold text-white">{player}</span>? They will be disconnected and unable to rejoin.</>,
            confirmLabel: 'Ban',
            tone: 'danger',
        }))) return;
        const result = await runPlayerCommand(id!, command, player);
        notify(result);
        if (result.ok && (command === 'kick' || command === 'ban')) {
            // Drop them from the list now instead of waiting for the next status ping.
            setPlayers(prev => prev.filter(p => p.name !== player));
            setOnlineCount(prev => Math.max(0, prev - 1));
        }
        fetchKnown();
    };

    const onlineIds = new Set(players.map(p => String(p.id).toLowerCase()));
    const offline = known.filter(p => !p.online && !onlineIds.has(p.uuid));
    const flagsOf = (p: any) => known.find(k => k.uuid === String(p.id).toLowerCase()) || {};
    const openPlayer = (uuid: string) => navigate(`/server/${id}/players/${uuid}`);

    return (
        <div className="max-w-5xl space-y-6">
            <div className="flex flex-wrap gap-3">
                {(Object.keys(LISTS) as ListKey[]).map(key => (
                    <button key={key} onClick={() => setOpenList(key)}
                        className="glass-button flex-1 min-w-[150px] px-4 py-3 flex items-center justify-center gap-2 text-sm">
                        {LISTS[key].icon}{LISTS[key].label}
                    </button>
                ))}
            </div>

            {dialog}

            <div className="glass-panel rounded-xl overflow-hidden">
                <div className="p-5 border-b border-white/[0.04] bg-white/[0.02] flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-white">Online Players</h3>
                        <p className="text-sm text-slate-400 mt-1">Manage players currently connected to the server.</p>
                    </div>
                    <div className="bg-blue-600/20 border border-blue-500/30 px-4 py-2 rounded-lg flex items-center gap-2 shadow-inner">
                        <Users size={16} className="text-blue-400" />
                        <span className="text-blue-100 font-bold">{onlineCount} <span className="text-blue-300 font-normal">/ {maxCount}</span></span>
                    </div>
                </div>

                <div className="bg-black/20">
                    {players.length === 0 ? (
                        <div className="p-12 text-center flex flex-col items-center">
                            <div className="w-12 h-12 bg-black/40 rounded-full flex items-center justify-center mb-4 border border-white/5">
                                <Users size={20} className="text-slate-500" />
                            </div>
                            <p className="text-slate-400 font-medium">No players are currently online.</p>
                        </div>
                    ) : (
                        <table className="w-full text-left text-sm text-slate-300">
                            <thead className="bg-black/40 border-b border-white/[0.04]">
                                <tr>
                                    <th className="px-6 py-3 font-semibold text-slate-400">Player Name</th>
                                    <th className="px-6 py-3 text-right font-semibold text-slate-400">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.04]">
                                {players.map((p, i) => (
                                    <tr key={i} onClick={() => openPlayer(String(p.id).toLowerCase())} className="hover:bg-white/[0.02] transition-colors cursor-pointer">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <PlayerAvatar name={p.name} />
                                                <span className="font-semibold text-white">{p.name}</span>
                                                <FlagBadges p={flagsOf(p)} />
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                                            <button onClick={() => executeCommand('kick', p.name)} className="glass-button bg-yellow-500/10 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20 hover:text-yellow-300 px-3 py-1.5 mr-2">
                                                Kick
                                            </button>
                                            <button onClick={() => executeCommand('ban', p.name)} className="glass-button bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 hover:text-red-300 px-3 py-1.5 mr-2">
                                                Ban
                                            </button>
                                            <button onClick={() => executeCommand('op', p.name)} className="glass-button bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20 hover:text-blue-300 px-3 py-1.5">
                                                OP
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            <div className="glass-panel rounded-xl overflow-hidden">
                <div className="p-5 border-b border-white/[0.04] bg-white/[0.02] flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-white">Offline Players</h3>
                        <p className="text-sm text-slate-400 mt-1">Players who have joined this server before, from the world's saved player data.</p>
                    </div>
                    <div className="bg-white/5 border border-white/10 px-4 py-2 rounded-lg text-slate-300 font-bold">{offline.length}</div>
                </div>

                <div className="bg-black/20">
                    {offline.length === 0 ? (
                        <div className="p-12 text-center flex flex-col items-center">
                            <div className="w-12 h-12 bg-black/40 rounded-full flex items-center justify-center mb-4 border border-white/5">
                                <Users size={20} className="text-slate-500" />
                            </div>
                            <p className="text-slate-400 font-medium">No offline players with saved data.</p>
                        </div>
                    ) : (
                        <table className="w-full text-left text-sm text-slate-300">
                            <thead className="bg-black/40 border-b border-white/[0.04]">
                                <tr>
                                    <th className="px-6 py-3 font-semibold text-slate-400">Player Name</th>
                                    <th className="px-6 py-3 font-semibold text-slate-400">Last Seen</th>
                                    <th className="px-6 py-3" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.04]">
                                {offline.map(p => (
                                    <tr key={p.uuid} onClick={() => openPlayer(p.uuid)} className="hover:bg-white/[0.02] transition-colors cursor-pointer">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <PlayerAvatar name={p.name} />
                                                <span className="font-semibold text-white">{p.name || <span className="font-mono text-slate-400">{p.uuid}</span>}</span>
                                                <FlagBadges p={p} />
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-400">{formatDate(p.lastSeen)}</td>
                                        <td className="px-6 py-4 text-right text-slate-500"><ChevronRight size={16} className="inline" /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {openList && <ListManager serverId={id!} listKey={openList} onClose={() => setOpenList(null)} onChanged={fetchKnown} />}
        </div>
    );
};
