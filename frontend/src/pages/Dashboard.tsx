import React from 'react';
import { useServersStore } from '../store/useServersStore';
import { Link, useNavigate } from 'react-router-dom';
import { Play, Square, Settings, Terminal, Plus, Cpu, MemoryStick } from 'lucide-react';
import axios from 'axios';

export const Dashboard = () => {
    const servers = useServersStore(s => s.servers);
    React.useEffect(() => { useServersStore.getState().fetchServers(); }, []);
    const navigate = useNavigate();

    const getBadge = (status: string) => {
        switch (status) {
            case 'ONLINE': return <span className="bg-[#2ed573]/15 text-[#2ed573] text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase">ONLINE</span>;
            case 'OFFLINE': return <span className="bg-[#ff4757]/15 text-[#ff4757] text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase">OFFLINE</span>;
            case 'STARTING':
            case 'RECOVERING': return <span className="bg-white/10 text-slate-400 text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase">{status}</span>;
            case 'EULA_PENDING': return <span className="bg-blue-500/15 text-blue-400 text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase">EULA PENDING</span>;
            default: return <span className="bg-white/10 text-slate-400 text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase">{status}</span>;
        }
    };

    return (
        <div className="w-full">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-white mb-1">Servers</h1>
                    <p className="text-sm text-slate-400">Manage your RamsCraft instances.</p>
                </div>
                <button 
                    onClick={() => navigate('/create')}
                    className="glass-button bg-blue-600/20 text-blue-400 border-blue-500/30 hover:bg-blue-600/30 hover:text-white px-4 py-2 flex items-center gap-2 shadow-lg shadow-blue-900/20"
                >
                    <Plus size={16} />
                    Create Server
                </button>
            </div>

            {servers.length === 0 ? (
                <div className="glass-panel rounded-xl p-12 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 bg-black/40 rounded-full flex items-center justify-center mb-4 border border-white/5">
                        <Terminal size={24} className="text-slate-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-2">No servers found</h3>
                    <p className="text-sm text-slate-400 max-w-md mb-6">You haven't created any Minecraft servers yet. Create one to get started.</p>
                    <button onClick={() => navigate('/create')} className="glass-button px-6 py-2">
                        Create your first server
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {servers.map(server => (
                        <Link 
                            key={server.id} 
                            to={`/server/${server.id}`}
                            className="glass-card flex flex-col overflow-hidden group block"
                        >
                            <div className="p-4 flex items-center gap-4">
                                <div className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br from-[#2b5876] to-[#4e4376]">
                                    <Terminal size={20} className="text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-0.5">
                                        <h3 className="text-[15px] font-semibold text-white truncate pr-2">{server.name}</h3>
                                        {getBadge(server.status)}
                                    </div>
                                    <div className="text-[12px] text-slate-400 truncate capitalize">
                                        {server.software?.provider || 'Unknown'} {server.software?.mcVersion || ''}
                                    </div>
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-2 bg-black/20 border-t border-white/[0.04]">
                                <div className="p-2.5 text-center border-r border-white/[0.04]">
                                    <div className="text-sm font-semibold text-slate-200 mb-0.5">—</div>
                                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">CPU</div>
                                </div>
                                <div className="p-2.5 text-center">
                                    <div className="text-sm font-semibold text-slate-200 mb-0.5">{(server.maxRamMb / 1024).toFixed(1)}GB</div>
                                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">Max RAM</div>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
};

