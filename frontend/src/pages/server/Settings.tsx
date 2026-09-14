import toast from 'react-hot-toast';
import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useServersStore } from '../../store/useServersStore';
import { Save, AlertTriangle } from 'lucide-react';
import axios from 'axios';

export const Settings = () => {
    const { id } = useParams<{id: string}>();
    const server = useServersStore(s => s.servers.find(srv => srv.id === id));
    const fetchServers = useServersStore(s => s.fetchServers);
    const navigate = useNavigate();

    // Instance State
    const [name, setName] = useState('');
    const [publicAddress, setPublicAddress] = useState('');
    const [minRam, setMinRam] = useState(1024);
    const [maxRam, setMaxRam] = useState(2048);
    const [savingInstance, setSavingInstance] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = async () => {
        if (!window.confirm('Are you absolutely sure you want to delete this server? All files and worlds will be permanently destroyed!')) return;
        
        setIsDeleting(true);
        try {
            await axios.delete(`/api/servers/${id}`);
            await fetchServers();
            navigate('/');
        } catch (e) {
            console.error("Failed to delete server", e);
            toast.error('Failed to delete server. Check the console for details.');
            setIsDeleting(false);
        }
    };

    // Properties State
    const [properties, setProperties] = useState<Record<string, string>>({});
    const [savingProps, setSavingProps] = useState(false);

    useEffect(() => {
        if (server) {
            setName(server.name);
            setPublicAddress(server.publicAddress || '');
            setMinRam(server.minRamMb || 1024);
            setMaxRam(server.maxRamMb || 2048);
        }
    }, [server]);

    useEffect(() => {
        const loadProps = async () => {
            if (!id) return;
            try {
                const res = await axios.get(`/api/servers/${id}/settings`);
                setProperties(res.data);
            } catch (e) {
                console.error("Failed to load properties", e);
            }
        };
        loadProps();
    }, [id]);

    if (!server) return null;

    const saveInstance = async () => {
        try {
            setSavingInstance(true);
            await axios.patch(`/api/servers/${id}`, {
                name,
                publicAddress,
                minRamMb: minRam,
                maxRamMb: maxRam
            });
            await fetchServers();
            toast.success('Instance settings saved successfully');
        } catch (e: any) {
            console.error(e);
            toast.error(e.response?.data?.error || 'Failed to save instance settings');
        } finally {
            setSavingInstance(false);
        }
    };

    const saveProperties = async () => {
        try {
            setSavingProps(true);
            await axios.patch(`/api/servers/${id}/settings`, properties);
            toast.success('Minecraft configuration saved successfully');
        } catch (e: any) {
            console.error(e);
            toast.error(e.response?.data?.error || 'Failed to save configuration');
        } finally {
            setSavingProps(false);
        }
    };

    const updateProp = (key: string, val: string | boolean) => {
        setProperties(prev => ({ ...prev, [key]: String(val) }));
    };

    return (
        <div className="max-w-4xl space-y-6">
            {/* Instance Settings */}
            <div className="glass-panel rounded-xl overflow-hidden">
                <div className="p-5 border-b border-white/[0.04] bg-white/[0.02]">
                    <h3 className="text-lg font-semibold text-white">Instance Settings</h3>
                    <p className="text-sm text-slate-400 mt-1">Configure RamsCraft management settings for this server.</p>
                </div>
                
                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Server Name</label>
                            <input 
                                type="text" 
                                value={name}
                                onChange={e => setName(e.target.value)}
                                className="w-full glass-input"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Public Connection Address (Optional)</label>
                            <input 
                                type="text" 
                                value={publicAddress}
                                onChange={e => setPublicAddress(e.target.value)}
                                placeholder="e.g. playit.example.com:12345"
                                className="w-full glass-input"
                            />
                            <p className="text-xs text-slate-500 mt-2">Does not change server port. Display only.</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Minimum RAM (MB)</label>
                            <input 
                                type="number" 
                                value={minRam}
                                onChange={e => setMinRam(Number(e.target.value))}
                                className="w-full glass-input"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Maximum RAM (MB)</label>
                            <input 
                                type="number" 
                                value={maxRam}
                                onChange={e => setMaxRam(Number(e.target.value))}
                                className="w-full glass-input"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-300 mb-2">Local Port</label>
                            <input 
                                type="number" 
                                value={server.port}
                                className="w-full glass-input bg-black/20 text-slate-400 cursor-not-allowed"
                                disabled
                            />
                        </div>
                    </div>
                </div>
                
                <div className="p-5 border-t border-white/[0.04] bg-black/20 flex justify-end">
                    <button 
                        onClick={saveInstance}
                        disabled={savingInstance}
                        className="glass-button bg-blue-600/20 text-blue-400 border-blue-500/30 hover:bg-blue-600/30 hover:text-white px-6 py-2 flex items-center gap-2"
                    >
                        <Save size={16} />
                        {savingInstance ? 'Saving...' : 'Save Instance Settings'}
                    </button>
                </div>
            </div>

            {/* Minecraft Configuration */}
            <div className="glass-panel rounded-xl overflow-hidden">
                <div className="p-5 border-b border-white/[0.04] bg-white/[0.02] flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            Minecraft Configuration
                            <span className="text-[10px] font-bold bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded border border-amber-500/20">Requires Restart</span>
                        </h3>
                        <p className="text-sm text-slate-400 mt-1">Changes are written to server.properties.</p>
                    </div>
                    <Link to={`/server/${id}/files`} className="glass-button px-4 py-2 text-sm text-slate-300 hover:text-white">
                        Advanced Configuration
                    </Link>
                </div>
                
                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Max Players</label>
                            <input 
                                type="number" 
                                value={properties['max-players'] || '20'}
                                onChange={e => updateProp('max-players', e.target.value)}
                                className="w-full glass-input"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Gamemode</label>
                            <select 
                                value={properties['gamemode'] || 'survival'}
                                onChange={e => updateProp('gamemode', e.target.value)}
                                className="w-full glass-input appearance-none bg-black/40"
                            >
                                <option className="bg-slate-900 text-white" value="survival">Survival</option>
                                <option className="bg-slate-900 text-white" value="creative">Creative</option>
                                <option className="bg-slate-900 text-white" value="adventure">Adventure</option>
                                <option className="bg-slate-900 text-white" value="spectator">Spectator</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Difficulty</label>
                            <select 
                                value={properties['difficulty'] || 'easy'}
                                onChange={e => updateProp('difficulty', e.target.value)}
                                className="w-full glass-input appearance-none bg-black/40"
                            >
                                <option className="bg-slate-900 text-white" value="peaceful">Peaceful</option>
                                <option className="bg-slate-900 text-white" value="easy">Easy</option>
                                <option className="bg-slate-900 text-white" value="normal">Normal</option>
                                <option className="bg-slate-900 text-white" value="hard">Hard</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Spawn Protection</label>
                            <input 
                                type="number" 
                                value={properties['spawn-protection'] || '16'}
                                onChange={e => updateProp('spawn-protection', e.target.value)}
                                className="w-full glass-input"
                            />
                        </div>
                        <div className="md:col-span-2 grid grid-cols-2 gap-4 pt-4 border-t border-white/[0.04]">
                            <label className="flex items-center gap-3 p-3 bg-black/20 border border-white/5 rounded-lg cursor-pointer hover:bg-white/[0.02] transition-colors">
                                <input 
                                    type="checkbox" 
                                    checked={properties['white-list'] === 'true'}
                                    onChange={e => updateProp('white-list', e.target.checked)}
                                    className="rounded border-slate-600 bg-slate-800 text-blue-500"
                                />
                                <span className="text-sm font-medium text-slate-300">Enable Whitelist</span>
                            </label>
                            <label className="flex items-center gap-3 p-3 bg-black/20 border border-white/5 rounded-lg cursor-pointer hover:bg-white/[0.02] transition-colors">
                                <input 
                                    type="checkbox" 
                                    checked={properties['online-mode'] !== 'false'}
                                    onChange={e => updateProp('online-mode', e.target.checked)}
                                    className="rounded border-slate-600 bg-slate-800 text-blue-500"
                                />
                                <div>
                                    <span className="text-sm font-medium text-slate-300 block">Online Mode (Premium)</span>
                                    <span className="text-xs text-slate-500">Uncheck to allow cracked clients</span>
                                </div>
                            </label>
                            <label className="flex items-center gap-3 p-3 bg-black/20 border border-white/5 rounded-lg cursor-pointer hover:bg-white/[0.02] transition-colors">
                                <input 
                                    type="checkbox" 
                                    checked={properties['allow-flight'] === 'true'}
                                    onChange={e => updateProp('allow-flight', e.target.checked)}
                                    className="rounded border-slate-600 bg-slate-800 text-blue-500"
                                />
                                <span className="text-sm font-medium text-slate-300">Allow Flight</span>
                            </label>
                            <label className="flex items-center gap-3 p-3 bg-black/20 border border-white/5 rounded-lg cursor-pointer hover:bg-white/[0.02] transition-colors">
                                <input 
                                    type="checkbox" 
                                    checked={properties['force-gamemode'] === 'true'}
                                    onChange={e => updateProp('force-gamemode', e.target.checked)}
                                    className="rounded border-slate-600 bg-slate-800 text-blue-500"
                                />
                                <div>
                                    <span className="text-sm font-medium text-slate-300 block">Force Gamemode</span>
                                    <span className="text-xs text-slate-500">Apply gamemode on join</span>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>
                
                <div className="p-5 border-t border-white/[0.04] bg-black/20 flex justify-end">
                    <button 
                        onClick={saveProperties}
                        disabled={savingProps}
                        className="glass-button bg-blue-600/20 text-blue-400 border-blue-500/30 hover:bg-blue-600/30 hover:text-white px-6 py-2 flex items-center gap-2"
                    >
                        <Save size={16} />
                        {savingProps ? 'Saving...' : 'Save Configuration'}
                    </button>
                </div>
            </div>

            {/* Danger Zone */}
            <div className="glass-panel rounded-xl overflow-hidden border-red-500/20">
                <div className="p-5 border-b border-red-500/10 bg-red-500/5">
                    <h3 className="text-lg font-semibold text-red-400">Danger Zone</h3>
                </div>
                
                <div className="p-6 flex items-center justify-between">
                    <div>
                        <h4 className="text-white font-medium mb-1">Delete Server</h4>
                        <p className="text-sm text-slate-400">Permanently remove this server and all its files. This action cannot be undone.</p>
                    </div>
                    <button 
                        className="glass-button bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20 hover:text-red-300 px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={handleDelete}
                        disabled={isDeleting}
                    >
                        {isDeleting ? 'Deleting...' : 'Delete Server'}
                    </button>
                </div>
            </div>
        </div>
    );
};
