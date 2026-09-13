import React from 'react';
import { useParams } from 'react-router-dom';
import { useServersStore } from '../../store/useServersStore';
import { Play, Square, Settings, Cpu, MemoryStick, Users, Clock, Terminal } from 'lucide-react';
import axios from 'axios';

export const ServerOverview = () => {
    const { id } = useParams<{id: string}>();
    const server = useServersStore(s => s.servers.find(srv => srv.id === id));

    if (!server) return null;

    const handlePower = async (action: 'start' | 'stop') => {
        try {
            await axios.post(`http://192.168.1.6:3001/api/servers/${id}/${action}`);
        } catch (error) {
            console.error('Power action failed', error);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 flex flex-col gap-6">
                {/* Control Card */}
                <div className="glass-panel rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-white mb-4">Power Controls</h3>
                    <div className="flex gap-4">
                        <button 
                            onClick={() => handlePower('start')}
                            disabled={server.status !== 'OFFLINE' && server.status !== 'EULA_PENDING'}
                            className="flex-1 bg-[#2ed573]/20 hover:bg-[#2ed573]/30 text-[#2ed573] border border-[#2ed573]/30 disabled:opacity-30 disabled:hover:bg-[#2ed573]/20 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition-all shadow-[0_0_15px_rgba(46,213,115,0.1)]"
                        >
                            <Play size={18} fill="currentColor" />
                            Start Server
                        </button>
                        <button 
                            onClick={() => handlePower('stop')}
                            disabled={server.status === 'OFFLINE' || server.status === 'STOPPING'}
                            className="flex-1 bg-[#ff4757]/20 hover:bg-[#ff4757]/30 text-[#ff4757] border border-[#ff4757]/30 disabled:opacity-30 disabled:hover:bg-[#ff4757]/20 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition-all shadow-[0_0_15px_rgba(255,71,87,0.1)]"
                        >
                            <Square size={18} fill="currentColor" />
                            Stop Server
                        </button>
                    </div>
                </div>

                {/* Info Card */}
                <div className="glass-panel rounded-xl p-0 overflow-hidden">
                    <div className="p-5 border-b border-white/[0.04] bg-white/[0.02]">
                        <h3 className="text-lg font-semibold text-white">Connection Details</h3>
                    </div>
                    <div className="p-6 space-y-4">
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Server Address</label>
                            <div className="flex items-center gap-2">
                                <code className="bg-black/40 px-3 py-2 rounded border border-white/10 text-slate-200 font-mono text-sm flex-1">
                                    play.ramscraft.net:{server.port}
                                </code>
                                <button className="glass-button px-4 py-2">Copy</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-6">
                {/* Metrics */}
                <div className="glass-panel rounded-xl p-0 overflow-hidden">
                    <div className="p-5 border-b border-white/[0.04] bg-white/[0.02]">
                        <h3 className="text-lg font-semibold text-white">Live Metrics</h3>
                    </div>
                    <div className="p-5 space-y-6">
                        <div>
                            <div className="flex justify-between text-sm mb-1.5">
                                <span className="text-slate-400 flex items-center gap-2"><Cpu size={14} /> CPU Usage</span>
                                <span className="text-white font-semibold">12%</span>
                            </div>
                            <div className="w-full bg-black/40 rounded-full h-2 border border-white/5 overflow-hidden">
                                <div className="bg-blue-500 h-2 rounded-full" style={{ width: '12%' }}></div>
                            </div>
                        </div>
                        <div>
                            <div className="flex justify-between text-sm mb-1.5">
                                <span className="text-slate-400 flex items-center gap-2"><MemoryStick size={14} /> RAM Usage</span>
                                <span className="text-white font-semibold">1.2 GB / 4 GB</span>
                            </div>
                            <div className="w-full bg-black/40 rounded-full h-2 border border-white/5 overflow-hidden">
                                <div className="bg-purple-500 h-2 rounded-full" style={{ width: '30%' }}></div>
                            </div>
                        </div>
                        <div className="pt-2 border-t border-white/[0.04]">
                            <div className="flex justify-between text-sm py-2">
                                <span className="text-slate-400 flex items-center gap-2"><Users size={14} /> Players</span>
                                <span className="text-white font-semibold">0 / 20</span>
                            </div>
                            <div className="flex justify-between text-sm py-2">
                                <span className="text-slate-400 flex items-center gap-2"><Clock size={14} /> Uptime</span>
                                <span className="text-white font-semibold">2h 15m</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
