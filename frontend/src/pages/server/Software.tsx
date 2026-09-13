import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { useServersStore } from '../../store/useServersStore';
import { HardDrive, AlertTriangle, Download, Terminal } from 'lucide-react';

export const Software = () => {
    const { id } = useParams();
    const server = useServersStore(s => s.servers.find(srv => srv.id === id));
    
    const [providers, setProviders] = useState([]);
    const [selectedProvider, setSelectedProvider] = useState('');
    const [versions, setVersions] = useState([]);
    const [selectedVersion, setSelectedVersion] = useState('');
    const [releases, setReleases] = useState([]);
    const [selectedRelease, setSelectedRelease] = useState('');
    const [isInstalling, setIsInstalling] = useState(false);

    useEffect(() => {
        axios.get(`/api/software/providers`).then(res => setProviders(res.data));
    }, []);

    useEffect(() => {
        if (selectedProvider) {
            axios.get(`/api/software/providers/${selectedProvider}/versions`).then(res => setVersions(res.data));
            setSelectedVersion('');
            setSelectedRelease('');
        }
    }, [selectedProvider]);

    useEffect(() => {
        if (selectedProvider && selectedVersion) {
            axios.get(`/api/software/providers/${selectedProvider}/versions/${selectedVersion}/releases`).then(res => setReleases(res.data));
            setSelectedRelease('');
        }
    }, [selectedVersion]);

    if (!server) return null;

    const handleInstall = async () => {
        if (!confirm('WARNING: Installing new software may delete your current server jar and could be incompatible with your worlds or plugins. Ensure the server is offline and you have a backup. Continue?')) return;
        setIsInstalling(true);
        try {
            await axios.post(`/api/servers/${id}/software/install`, {
                providerId: selectedProvider,
                mcVersion: selectedVersion,
                releaseId: selectedRelease
            });
            alert('Software installed successfully.');
            // Refresh server state
            useServersStore.getState().fetchServers();
        } catch (e) {
            alert('Installation failed.');
            console.error(e);
        } finally {
            setIsInstalling(false);
        }
    };

    return (
        <div className="max-w-4xl space-y-6">
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
                            <div className="text-white capitalize">{server.software?.provider || 'Unknown'}</div>
                        </div>
                        <div className="bg-black/20 p-4 rounded-lg border border-white/5">
                            <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">MC Version</div>
                            <div className="text-white">{server.software?.mcVersion || 'Unknown'}</div>
                        </div>
                        <div className="bg-black/20 p-4 rounded-lg border border-white/5">
                            <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Release</div>
                            <div className="text-white">{server.software?.releaseId || 'Unknown'}</div>
                        </div>
                        <div className="bg-black/20 p-4 rounded-lg border border-white/5">
                            <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Java Runtime</div>
                            <div className="text-white">Java {server.javaRuntimeId || '17'}</div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="glass-panel rounded-xl overflow-hidden border-orange-500/20">
                <div className="p-5 border-b border-orange-500/10 bg-orange-500/5">
                    <h3 className="text-lg font-semibold text-orange-400 flex items-center gap-2">
                        <AlertTriangle size={18} /> Change Software
                    </h3>
                    <p className="text-sm text-slate-400 mt-1">Select a new server jar to install. Server must be OFFLINE.</p>
                </div>
                
                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Provider</label>
                            <select 
                                value={selectedProvider} 
                                onChange={e => setSelectedProvider(e.target.value)}
                                className="w-full glass-input appearance-none bg-black/40"
                                disabled={isInstalling}
                            >
                                <option value="">Select Provider...</option>
                                {providers.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Minecraft Version</label>
                            <select 
                                value={selectedVersion} 
                                onChange={e => setSelectedVersion(e.target.value)}
                                className="w-full glass-input appearance-none bg-black/40"
                                disabled={!selectedProvider || isInstalling}
                            >
                                <option value="">Select Version...</option>
                                {versions.map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Build / Release</label>
                            <select 
                                value={selectedRelease} 
                                onChange={e => setSelectedRelease(e.target.value)}
                                className="w-full glass-input appearance-none bg-black/40"
                                disabled={!selectedVersion || isInstalling}
                            >
                                <option value="">Select Release...</option>
                                {releases.map(r => <option key={r.id} value={r.id}>{r.id} ({new Date(r.time).toLocaleDateString()})</option>)}
                            </select>
                        </div>
                    </div>
                    
                    <button 
                        onClick={handleInstall}
                        disabled={!selectedRelease || server.status !== 'OFFLINE' || isInstalling}
                        className="glass-button bg-orange-500/10 text-orange-400 border-orange-500/30 hover:bg-orange-500/20 px-6 py-2 flex items-center gap-2 disabled:opacity-50"
                    >
                        <Download size={16} />
                        {isInstalling ? 'Installing...' : 'Install Software'}
                    </button>
                    {server.status !== 'OFFLINE' && <p className="text-xs text-orange-500 mt-2">You must stop the server first.</p>}
                </div>
            </div>
        </div>
    );
};
