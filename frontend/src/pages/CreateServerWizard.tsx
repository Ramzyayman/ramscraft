import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';

export const CreateServerWizard = () => {
    const [name, setName] = useState('');
    const [port, setPort] = useState(25565);
    const [software, setSoftware] = useState('paper');
    const [version, setVersion] = useState('');
    const [memory, setMemory] = useState(2048);
    
    const [providers, setProviders] = useState<any[]>([]);
    const [versions, setVersions] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    
    const navigate = useNavigate();

    useEffect(() => {
        axios.get('http://192.168.1.6:3001/api/software/providers')
            .then(res => setProviders(res.data))
            .catch(e => console.error(e));
    }, []);

    useEffect(() => {
        if (software) {
            axios.get(`http://192.168.1.6:3001/api/software/providers/${software}/versions`)
                .then(res => {
                    setVersions(res.data);
                    if (res.data.length > 0) setVersion(res.data[0].version);
                })
                .catch(e => console.error(e));
        }
    }, [software]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await axios.post('http://192.168.1.6:3001/api/servers', {
                name,
                port: Number(port),
                minRamMb: memory,
                maxRamMb: memory
            });
            
            // Now fetch releases for the chosen version
            const relRes = await axios.get(`http://192.168.1.6:3001/api/software/providers/${software}/versions/${version}/releases`);
            const releaseId = relRes.data.length > 0 ? relRes.data[0].id : null;
            
            if (releaseId) {
                await axios.post(`http://192.168.1.6:3001/api/servers/${res.data.id}/software/install`, {
                    providerId: software,
                    mcVersion: version,
                    releaseId: releaseId
                });
            }
            navigate(`/server/${res.data.id}`);
        } catch (e: any) {
            console.error('Failed to create server: ' + (e.response?.data?.error || e.message));
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
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Version</label>
                            <select 
                                value={version}
                                onChange={e => setVersion(e.target.value)}
                                className="w-full glass-input"
                                disabled={versions.length === 0}
                            >
                                {versions.map(v => (
                                    <option key={v.version} value={v.version}>{v.version}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">RAM (MB)</label>
                            <input 
                                type="number" 
                                required
                                min="512"
                                value={memory}
                                onChange={e => setMemory(Number(e.target.value))}
                                className="w-full glass-input"
                            />
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
                        disabled={loading}
                        className="glass-button bg-blue-600/20 text-blue-400 border-blue-500/30 hover:bg-blue-600/30 hover:text-white px-6 py-2.5 flex items-center gap-2"
                    >
                        <Plus size={16} />
                        {loading ? 'Creating...' : 'Create Server'}
                    </button>
                </div>
            </form>
        </div>
    );
};
