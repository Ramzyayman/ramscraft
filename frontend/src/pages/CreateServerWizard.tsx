import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { Plus, AlertTriangle } from 'lucide-react';

export const CreateServerWizard = () => {
    const [name, setName] = useState('');
    const [port, setPort] = useState(25565);
    const [software, setSoftware] = useState('paper');
    const [version, setVersion] = useState('');
    const [minMemory, setMinMemory] = useState(1024);
    const [maxMemory, setMaxMemory] = useState(2048);
    
    const [providers, setProviders] = useState<any[]>([]);
    const [versions, setVersions] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();

    useEffect(() => {
        axios.get('/api/software/providers')
            .then(res => setProviders(res.data))
            .catch(e => console.error(e));
    }, []);

    useEffect(() => {
        if (software) {
            setLoading(true);
            axios.get(`/api/software/providers/${software}/versions`)
                .then(res => {
                    setVersions(res.data);
                    if (res.data.length > 0) {
                        const val = typeof res.data[0] === 'string' ? res.data[0] : res.data[0].version;
                        setVersion(val);
                    } else {
                        setVersion('');
                    }
                })
                .catch(e => {
                    console.error(e);
                    setVersions([]);
                    setVersion('');
                })
                .finally(() => setLoading(false));
        } else {
            setVersions([]);
            setVersion('');
        }
    }, [software]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const res = await axios.post('/api/servers', {
                name,
                port: Number(port),
                minRamMb: minMemory,
                maxRamMb: maxMemory
            });
            
            // Now fetch releases for the chosen version
            const relRes = await axios.get(`/api/software/providers/${software}/versions/${version}/releases`);
            const releaseId = relRes.data.length > 0 ? relRes.data[0].id : null;
            
            if (releaseId) {
                await axios.post(`/api/servers/${res.data.id}/software/install`, {
                    providerId: software,
                    mcVersion: version,
                    releaseId: releaseId
                });
            }
            navigate(`/server/${res.data.id}`);
        } catch (e: any) {
            const errMsg = e.response?.data?.error || e.message;
            console.error('Failed to create server: ' + errMsg);
            setError(`Failed to create server: ${errMsg}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white mb-1">Create New Server</h1>
                <p className="text-sm text-slate-400">Deploy a new Minecraft instance in seconds.</p>
            </div>
            
            {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg flex items-center gap-2">
                    <AlertTriangle size={16} />
                    <span>{error}</span>
                </div>
            )}
            
            <form onSubmit={handleSubmit} className="glass-panel rounded-xl overflow-hidden">
                <div className="p-6 space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Server Name</label>
                        <input 
                            type="text" 
                            required
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full glass-input"
                            placeholder="My Awesome Server"
                        />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Software</label>
                            <select 
                                value={software}
                                onChange={e => setSoftware(e.target.value)}
                                className="w-full glass-input"
                            >
                                {providers.map(p => (
                                    <option className="bg-slate-900 text-white" key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Version</label>
                            {loading ? (
                                <div className="text-slate-400">Loading versions...</div>
                            ) : versions.length === 0 ? (
                                <div className="text-red-400 text-sm py-2 px-3 bg-red-900/20 border border-red-500/30 rounded-lg">
                                    No compatible versions found or provider API unavailable.
                                </div>
                            ) : (
                                <select 
                                    value={version}
                                    onChange={e => setVersion(e.target.value)}
                                    className="w-full glass-input"
                                >
                                    {versions.map(v => {
                                        const val = typeof v === 'string' ? v : v.version;
                                        return <option className="bg-slate-900 text-white" key={val} value={val}>{val}</option>;
                                    })}
                                </select>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Min RAM (MB)</label>
                                <input 
                                    type="number" 
                                    required
                                    min="512"
                                    value={minMemory}
                                    onChange={e => setMinMemory(Number(e.target.value))}
                                    className="w-full glass-input"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Max RAM (MB)</label>
                                <input 
                                    type="number" 
                                    required
                                    min="512"
                                    value={maxMemory}
                                    onChange={e => setMaxMemory(Number(e.target.value))}
                                    className="w-full glass-input"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Port</label>
                            <input 
                                type="number" 
                                required
                                min="1024"
                                max="65535"
                                value={port}
                                onChange={e => setPort(Number(e.target.value))}
                                className="w-full glass-input"
                            />
                        </div>
                    </div>
                </div>
                
                <div className="p-5 bg-black/20 border-t border-white/[0.04] flex justify-end">
                    <button 
                        type="submit" 
                        disabled={loading || !name || !port || !version || versions.length === 0}
                        className="glass-button bg-blue-600/20 text-blue-400 border-blue-500/30 hover:bg-blue-600/30 hover:text-white px-6 py-2.5 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Plus size={16} />
                        {loading ? 'Creating...' : 'Create Server'}
                    </button>
                </div>
            </form>
        </div>
    );
};
