import toast from 'react-hot-toast';
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useServersStore } from '../../store/useServersStore';
import { Play, Square, Settings, Cpu, MemoryStick, Users, Clock, Terminal } from 'lucide-react';
import axios from 'axios';
import { socket } from '../../App';

const copyToClipboard = (text: string) => {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text);
    } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
        } catch (error) {
            console.error('Fallback copy failed', error);
        }
        textArea.remove();
    }
    // Optional: could add a toast notification here
};

const formatUptime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
};

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 MB';
    const mb = bytes / 1024 / 1024;
    if (mb > 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${Math.round(mb)} MB`;
};

export const ServerOverview = () => {
    const { id } = useParams<{id: string}>();
    const server = useServersStore(s => s.servers.find(srv => srv.id === id));
    
    const [stats, setStats] = useState<{cpu: number, memory: number, uptimeMs: number, players: {online: number, max: number} | null} | null>(null);

    const [isRestarting, setIsRestarting] = useState(false);

    useEffect(() => {
        if (!server || (server.status !== 'ONLINE' && server.status !== 'STARTING')) {
            setStats(null);
            return;
        }

        const handleStats = (data: any) => {
            if (data.serverId === id) {
                setStats(data);
            }
        };

        socket.on('serverStats', handleStats);
        socket.emit('subscribe:server', id);

        return () => {
            socket.off('serverStats', handleStats);
            socket.emit('unsubscribe:server', id);
        };
    }, [id, server?.status]);

    if (!server) return null;

    const handlePower = async (action: 'start' | 'stop') => {
        try {
            await axios.post(`/api/servers/${id}/lifecycle/${action}`);
            toast.success(`Server ${action} command sent`);
        } catch (error: any) {
            if (error.response?.data?.status === 'EULA_PENDING') {
                // Not a failure: the Accept EULA prompt replaces the buttons (refetch in case the socket missed it).
                useServersStore.getState().fetchServers();
                return;
            }
            console.error('Power action failed', error);
            toast.error(`Failed to ${action} server: ${error.response?.data?.error || error.message}`);
        }
    };

    const handleRestart = async () => {
        try {
            setIsRestarting(true);
            toast.success('Restart initiated...');
            await axios.post(`/api/servers/${id}/lifecycle/stop`);
            // The status state will asynchronously update. 
            // In a real app we'd wait for offline, but this is a simple naive approach
            setTimeout(async () => {
                try {
                    await axios.post(`/api/servers/${id}/lifecycle/start`);
                } catch(e) {}
                setIsRestarting(false);
            }, 3000);
        } catch (error: any) {
            setIsRestarting(false);
            toast.error(`Restart failed: ${error.message}`);
        }
    }

    const handleEula = async () => {
        try {
            await axios.post(`/api/servers/${id}/lifecycle/eula`);
            toast.success('EULA accepted. You can start the server now.');
            useServersStore.getState().fetchServers();
        } catch (error: any) {
            toast.error(`Failed to accept EULA: ${error.message}`);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 flex flex-col gap-6">
                {/* Control Card */}
                <div className="glass-panel rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-white mb-4">Power Controls</h3>
                    <div className="flex gap-4">
                        {server.status === 'EULA_PENDING' ? (
                            <div className="w-full bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg flex items-center justify-between">
                                <div className="text-sm text-blue-200">
                                    <strong className="text-blue-400 block mb-1">EULA Acceptance Required</strong>
                                    You must accept the Minecraft EULA to start the server.
                                </div>
                                <button 
                                    onClick={handleEula}
                                    className="bg-blue-500 hover:bg-blue-600 text-white font-semibold px-6 py-2 rounded shadow-lg shadow-blue-500/20 transition-all"
                                >
                                    Accept EULA
                                </button>
                            </div>
                        ) : (
                            <>
                                <button 
                                    onClick={() => handlePower('start')}
                                    disabled={server.status !== 'OFFLINE' && server.status !== 'CRASHED'}
                                    className="flex-1 bg-[#2ed573]/20 hover:bg-[#2ed573]/30 text-[#2ed573] border border-[#2ed573]/30 disabled:opacity-30 disabled:hover:bg-[#2ed573]/20 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition-all shadow-[0_0_15px_rgba(46,213,115,0.1)]"
                                >
                                    <Play size={18} fill="currentColor" />
                                    Start
                                </button>
                                <button 
                                    onClick={handleRestart}
                                    disabled={server.status === 'OFFLINE' || server.status === 'CRASHED' || isRestarting}
                                    className="flex-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-500 border border-amber-500/30 disabled:opacity-30 disabled:hover:bg-amber-500/20 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition-all"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                                    Restart
                                </button>
                                <button 
                                    onClick={() => handlePower('stop')}
                                    disabled={server.status === 'OFFLINE' || server.status === 'CRASHED' || server.status === 'STOPPING'}
                                    className="flex-1 bg-[#ff4757]/20 hover:bg-[#ff4757]/30 text-[#ff4757] border border-[#ff4757]/30 disabled:opacity-30 disabled:hover:bg-[#ff4757]/20 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition-all shadow-[0_0_15px_rgba(255,71,87,0.1)]"
                                >
                                    <Square size={18} fill="currentColor" />
                                    Stop
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Connection Information */}
                <div className="glass-panel rounded-xl overflow-hidden">
                    <div className="p-5 border-b border-white/[0.04] bg-white/[0.02]">
                        <h3 className="text-lg font-semibold text-white">Connection Details</h3>
                    </div>
                    <div className="p-6 flex items-center justify-between">
                        <div>
                            <div className="text-sm text-slate-400 mb-1">Local Address</div>
                            <div className="text-xl font-mono text-blue-400">
                                192.168.1.6:{server.port}
                            </div>
                        </div>
                        <button 
                            onClick={() => copyToClipboard(`192.168.1.6:${server.port}`)}
                            className="glass-button px-4 py-2 text-sm text-slate-300 hover:text-white"
                        >
                            Copy
                        </button>
                    </div>
                    {server.publicAddress && (
                        <div className="p-6 pt-0 flex items-center justify-between">
                            <div>
                                <div className="text-sm text-slate-400 mb-1">Public Address</div>
                                <div className="text-xl font-mono text-emerald-400">
                                    {server.publicAddress}:{server.port}
                                </div>
                            </div>
                            <button 
                                onClick={() => copyToClipboard(`${server.publicAddress}:${server.port}`)}
                                className="glass-button px-4 py-2 text-sm text-slate-300 hover:text-white"
                            >
                                Copy
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex flex-col gap-6">
                {/* Live Metrics */}
                <div className="glass-panel rounded-xl overflow-hidden h-full">
                    <div className="p-5 border-b border-white/[0.04] bg-white/[0.02]">
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            <Cpu size={18} className="text-blue-400" /> Live Metrics
                        </h3>
                    </div>
                    <div className="p-6">
                        <div className="space-y-6">
                            <div>
                                <div className="flex justify-between text-sm mb-2">
                                    <span className="text-slate-400 flex items-center gap-2"><Cpu size={14} /> CPU Usage</span>
                                    <span className="text-white font-mono">{stats ? stats.cpu.toFixed(1) : '0.0'}%</span>
                                </div>
                                <div className="w-full bg-black/40 rounded-full h-2 border border-white/5 overflow-hidden">
                                    <div className="bg-blue-500 h-2 rounded-full transition-all duration-1000" style={{ width: `${stats ? Math.min(100, stats.cpu) : 0}%` }}></div>
                                </div>
                            </div>
                            <div>
                                <div className="flex justify-between text-sm mb-2">
                                    <span className="text-slate-400 flex items-center gap-2"><MemoryStick size={14} /> RAM Usage</span>
                                    <span className="text-white font-mono">{stats ? (stats.memory / 1024 / 1024).toFixed(0) : '0'} MB / {server.maxRamMb} MB</span>
                                </div>
                                <div className="w-full bg-black/40 rounded-full h-2 border border-white/5 overflow-hidden">
                                    <div className="bg-purple-500 h-2 rounded-full transition-all duration-1000" style={{ width: `${stats ? Math.min(100, (stats.memory / 1024 / 1024) / server.maxRamMb * 100) : 0}%` }}></div>
                                </div>
                            </div>
                            
                            <div className="pt-2 border-t border-white/[0.04]">
                                <div className="flex justify-between text-sm py-2">
                                    <span className="text-slate-400 flex items-center gap-2"><Users size={14} /> Players</span>
                                    <span className="text-white font-semibold">
                                        {stats?.players ? `${stats.players.online}/${stats.players.max}` : '0/0'}
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm py-2">
                                    <span className="text-slate-400 flex items-center gap-2"><Clock size={14} /> Uptime</span>
                                    <span className="text-white font-semibold">{stats ? formatUptime(stats.uptimeMs) : 'Offline'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
