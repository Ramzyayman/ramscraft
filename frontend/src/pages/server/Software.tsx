import toast from 'react-hot-toast';
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { useServersStore } from '../../store/useServersStore';
import { HardDrive, AlertTriangle, Download, RefreshCw, Search } from 'lucide-react';
import { socket } from '../../App';

interface Provider {
    id: string;
    name: string;
    category: string;
    labels: { version: string; release: string };
    note: string | null;
    searchable: boolean;
}

interface InstallJob {
    serverId: string;
    state: 'running' | 'done' | 'error';
    providerName: string;
    phase: string;
    percent: number | null;
    detail: string;
    error?: string;
}

// Version options are plain Minecraft versions, or {id, label} (e.g. modpacks).
const optionOf = (v: string | { id: string; label: string }) => typeof v === 'string' ? { id: v, label: v } : v;

export const Software = () => {
    const { id } = useParams();
    const server = useServersStore(s => s.servers.find(srv => srv.id === id));

    const [providers, setProviders] = useState<Provider[]>([]);
    const [selectedProvider, setSelectedProvider] = useState('');
    const [versions, setVersions] = useState<{ id: string; label: string }[]>([]);
    const [selectedVersion, setSelectedVersion] = useState('');
    const [releases, setReleases] = useState<any[]>([]);
    const [selectedRelease, setSelectedRelease] = useState('');
    const [search, setSearch] = useState('');
    const [loadingVersions, setLoadingVersions] = useState(false);
    const [loadingReleases, setLoadingReleases] = useState(false);
    const [job, setJob] = useState<InstallJob | null>(null);
    const [showModal, setShowModal] = useState(false);

    const provider = providers.find(p => p.id === selectedProvider);
    const isInstalling = job?.state === 'running';

    useEffect(() => {
        axios.get(`/api/software/providers`).then(res => setProviders(res.data));
    }, []);

    // Pick up an install already in progress (page reload) and follow live progress.
    useEffect(() => {
        axios.get(`/api/servers/${id}/software/install`).then(res => {
            if (res.data?.state === 'running') setJob(res.data);
        }).catch(() => {});

        const onProgress = (data: InstallJob) => {
            if (data.serverId !== id) return;
            setJob(data);
            if (data.state === 'done') {
                toast.success(`${data.providerName} installed successfully.`);
                useServersStore.getState().fetchServers();
            } else if (data.state === 'error') {
                toast.error(data.error || 'Installation failed.');
            }
        };
        socket.on('softwareProgress', onProgress);
        return () => { socket.off('softwareProgress', onProgress); };
    }, [id]);

    // Versions for the chosen provider; searchable providers (modpacks) re-query as you type.
    useEffect(() => {
        setSelectedVersion('');
        setSelectedRelease('');
        setReleases([]);
        if (!selectedProvider) { setVersions([]); return; }
        const current = providers.find(p => p.id === selectedProvider);
        const timer = setTimeout(() => {
            setLoadingVersions(true);
            axios.get(`/api/software/providers/${selectedProvider}/versions`, { params: current?.searchable ? { query: search } : {} })
                .then(res => setVersions(res.data.map(optionOf)))
                .catch(e => {
                    setVersions([]);
                    toast.error(e.response?.data?.error || 'Could not load versions from the provider.');
                })
                .finally(() => setLoadingVersions(false));
        }, current?.searchable ? 400 : 0);
        return () => clearTimeout(timer);
    }, [selectedProvider, search]);

    useEffect(() => {
        setSelectedRelease('');
        setReleases([]);
        if (!selectedProvider || !selectedVersion) return;
        setLoadingReleases(true);
        axios.get(`/api/software/providers/${selectedProvider}/versions/${encodeURIComponent(selectedVersion)}/releases`)
            .then(res => setReleases(res.data))
            .catch(e => toast.error(e.response?.data?.error || 'Could not load releases from the provider.'))
            .finally(() => setLoadingReleases(false));
    }, [selectedVersion]);

    if (!server) return null;

    const handleInstall = async () => {
        setShowModal(false);
        try {
            const res = await axios.post(`/api/servers/${id}/software/install`, {
                providerId: selectedProvider,
                mcVersion: selectedVersion,
                releaseId: selectedRelease
            });
            setJob(res.data);
        } catch (e: any) {
            toast.error(e.response?.data?.error || 'Installation failed.');
        }
    };

    const isOffline = server.status === 'OFFLINE' || server.status === 'CRASHED' || server.status === 'EULA_PENDING';
    const providerName = (pid?: string) => providers.find(p => p.id === pid)?.name || pid || 'Unknown';
    // Paper/Purpur (26.x) keep world settings per dimension; every other software fails to load such a world.
    const paperFamily = (pid?: string) => pid === 'paper' || pid === 'purpur';
    const leavingPaper = paperFamily(server.software?.provider) && !!selectedProvider && !paperFamily(selectedProvider);

    return (
        <div className="max-w-4xl space-y-6 relative">
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="glass-panel w-full max-w-md p-6 rounded-xl border border-orange-500/30">
                        <div className="flex items-center gap-3 mb-4 text-orange-400">
                            <AlertTriangle size={24} />
                            <h3 className="text-lg font-semibold">Confirm Installation</h3>
                        </div>
                        <p className="text-sm text-slate-300 mb-6 leading-relaxed">
                            <span className="font-bold text-orange-400">WARNING:</span> installing a new software may crash if your current world conflicts with the new software. Delete world data to avoid that.
                        </p>
                        {leavingPaper && (
                            <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-3 -mt-3 mb-6 leading-relaxed">
                                This world was last run by {providerName(server.software?.provider)}, which saves worlds in its own layout. {provider?.name ?? 'Other software'} will crash on it with "Overworld settings missing". Take a backup, or delete the world first. Switching back to {providerName(server.software?.provider)} makes the world load again.
                            </p>
                        )}
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowModal(false)}
                                className="glass-button px-4 py-2 text-slate-300 hover:text-white"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleInstall}
                                className="glass-button bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 border-orange-500/30 px-4 py-2"
                            >
                                Continue Install
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="glass-panel rounded-xl overflow-hidden">
                <div className="p-5 border-b border-white/[0.04] bg-white/[0.02]">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        <HardDrive size={18} className="text-blue-400" /> Current Software
                    </h3>
                </div>
                <div className="p-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-black/20 p-4 rounded-lg border border-white/5">
                            <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Provider</div>
                            <div className="text-white">{server.software ? providerName(server.software.provider) : 'Unknown'}</div>
                        </div>
                        <div className="bg-black/20 p-4 rounded-lg border border-white/5">
                            <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">MC Version</div>
                            <div className="text-white">{server.software?.mcVersion || 'Unknown'}</div>
                        </div>
                        <div className="bg-black/20 p-4 rounded-lg border border-white/5">
                            <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Release</div>
                            <div className="text-white break-words">{server.software?.releaseId || 'Unknown'}</div>
                        </div>
                          <div className="bg-black/20 p-4 rounded-lg border border-white/5">
                              <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Java Runtime</div>
                              <div className="text-white">Java {server.javaRuntime?.majorVersion || '17 (Unassigned)'}</div>
                          </div>
                    </div>
                </div>
            </div>

            <div className="glass-panel rounded-xl overflow-hidden border-orange-500/20">
                <div className="p-5 border-b border-orange-500/10 bg-orange-500/5">
                    <h3 className="text-lg font-semibold text-orange-400 flex items-center gap-2">
                        <AlertTriangle size={18} /> Change Software
                    </h3>
                    <p className="text-sm text-slate-400 mt-1">Select new server software to install. Server must be OFFLINE. Your world, player data and server configuration are kept.</p>
                </div>

                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Provider</label>
                            <select
                                value={selectedProvider}
                                onChange={e => { setSearch(''); setSelectedProvider(e.target.value); }}
                                className="w-full glass-input appearance-none bg-black/40"
                                disabled={isInstalling}
                            >
                                <option className="bg-slate-900 text-white" value="">Select Provider...</option>
                                {providers.map(p => <option className="bg-slate-900 text-white" key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">{provider?.labels.version ?? 'Minecraft Version'}</label>
                            {provider?.searchable && (
                                <div className="relative mb-2">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                    <input
                                        value={search}
                                        onChange={e => setSearch(e.target.value)}
                                        placeholder={`Search ${provider.name.toLowerCase()}...`}
                                        className="w-full glass-input pl-8 text-sm"
                                        disabled={isInstalling}
                                    />
                                </div>
                            )}
                            <select
                                value={selectedVersion}
                                onChange={e => setSelectedVersion(e.target.value)}
                                className="w-full glass-input appearance-none bg-black/40"
                                disabled={!selectedProvider || isInstalling || loadingVersions}
                            >
                                <option className="bg-slate-900 text-white" value="">
                                    {loadingVersions ? 'Loading...' : selectedProvider && versions.length === 0 ? 'Nothing found' : `Select ${(provider?.labels.version ?? 'Version').toLowerCase()}...`}
                                </option>
                                {versions.map(v => <option className="bg-slate-900 text-white" key={v.id} value={v.id}>{v.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">{provider?.labels.release ?? 'Build / Release'}</label>
                            <select
                                value={selectedRelease}
                                onChange={e => setSelectedRelease(e.target.value)}
                                className="w-full glass-input appearance-none bg-black/40"
                                disabled={!selectedVersion || isInstalling || loadingReleases}
                            >
                                <option className="bg-slate-900 text-white" value="">
                                    {loadingReleases ? 'Loading...' : selectedVersion && releases.length === 0 ? 'Nothing available' : `Select ${(provider?.labels.release ?? 'Release').toLowerCase()}...`}
                                </option>
                                {releases.map(r => <option className="bg-slate-900 text-white" key={r.id} value={r.id}>{r.displayVersion}</option>)}
                            </select>
                        </div>
                    </div>

                    {provider?.note && <p className="text-xs text-slate-400 -mt-2">{provider.note}</p>}

                    {job && job.state !== 'done' && (
                        <div className={`p-4 rounded-lg border ${job.state === 'error' ? 'bg-red-500/10 border-red-500/20' : 'bg-black/20 border-white/5'}`}>
                            <div className="flex justify-between gap-4 text-sm mb-2">
                                <span className={`flex items-center gap-2 ${job.state === 'error' ? 'text-red-400' : 'text-slate-300'}`}>
                                    {job.state === 'running' ? <RefreshCw size={14} className="animate-spin text-orange-400" /> : <AlertTriangle size={14} />}
                                    {job.state === 'running' ? `${job.providerName}: ${job.phase}` : job.phase}
                                </span>
                                {job.state === 'running' && job.percent !== null && <span className="text-white font-mono">{job.percent}%</span>}
                            </div>
                            {job.state === 'running' && (
                                <div className="w-full bg-black/40 rounded-full h-2 border border-white/5 overflow-hidden">
                                    <div className={`h-2 rounded-full bg-orange-500 transition-all duration-500 ${job.percent === null ? 'w-1/3 animate-pulse' : ''}`}
                                        style={job.percent === null ? undefined : { width: `${job.percent}%` }} />
                                </div>
                            )}
                            <p className={`text-xs mt-2 font-mono break-all ${job.state === 'error' ? 'text-red-300' : 'text-slate-500'}`}>
                                {job.state === 'error' ? job.error : job.detail || ' '}
                            </p>
                        </div>
                    )}

                    <button
                        onClick={() => setShowModal(true)}
                        disabled={!selectedRelease || !isOffline || isInstalling}
                        className="glass-button bg-orange-500/10 text-orange-400 border-orange-500/30 hover:bg-orange-500/20 px-6 py-2 flex items-center gap-2 disabled:opacity-50"
                    >
                        <Download size={16} />
                        {isInstalling ? 'Installing...' : 'Install Software'}
                    </button>
                    {!isOffline && <p className="text-xs text-orange-500 mt-2">You must stop the server first.</p>}
                </div>
            </div>
        </div>
    );
};
