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
    
    const [stats, setStats] = useState<{cpu: number, memory: number, uptimeMs: number} | null>(null);

    useEffect(() => {
        if (!server || (server.status !== 'RUNNING' && server.status !== 'STARTING')) {
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
        } catch (error: any) {
            console.error('Power action failed', error);
            alert(`Failed to ${action} server: ${error.response?.data?.error || error.message}`);
        }
    };

    const handleEula = async () => {
        try {
            await axios.post(`/api/servers/${id}/lifecycle/eula`);
            useServersStore.getState().fetchServers();
        } catch (error: any) {
            alert(`Failed to accept EULA: ${error.message}`);
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
                                    disabled={server.status !== 'OFFLINE'}
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
                            </>
                        )}
                    </div>
                </div>

                {/* Info Card */}
                <div className="glass-panel rounded-xl p-0 overflow-hidden">
                    <div className="p-5 border-b border-white/[0.04] bg-white/[0.02]">
                        <h3 className="text-lg font-semibold text-white">Connection Details</h3>
                    </div>
                    <div className="p-6 space-y-6">
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">Local Address</label>
                            <div className="flex items-center gap-2">
                                <code className="bg-black/40 px-3 py-2 rounded border border-white/10 text-slate-200 font-mono text-sm flex-1">
                                    {window.location.hostname}:{server.port}
                                </code>
                                <button 
                                    onClick={() => copyToClipboard(`${window.location.hostname}:${server.port}`)}
                                    className="glass-button px-4 py-2"
                                >Copy</button>
                            </div>
                            <p className="text-xs text-slate-500 mt-2">Use this address to connect when on the same LAN or VPN.</p>
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">Public Connection</label>
                            {server.publicAddress ? (
                                <div className="flex items-center gap-2">
                                    <code className="bg-blue-900/20 px-3 py-2 rounded border border-blue-500/20 text-blue-300 font-mono text-sm flex-1">
                                        {server.publicAddress}
                                    </code>
                                    <button 
                                        onClick={() => copyToClipboard(server.publicAddress || '')}
                                        className="glass-button bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20 px-4 py-2"
                                    >Copy</button>
                                </div>
                            ) : (
                                <div className="bg-black/20 border border-white/5 rounded p-3 flex items-center justify-between">
                                    <span className="text-sm text-slate-400 italic">Not configured</span>
                                    <span className="text-xs text-slate-500">Configure in Settings</span>
                                </div>
                            )}
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
                                <span className="text-white font-semibold">{stats ? `${Math.round(stats.cpu)}%` : '0%'}</span>
                            </div>
                            <div className="w-full bg-black/40 rounded-full h-2 border border-white/5 overflow-hidden">
                                <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${stats ? Math.min(stats.cpu, 100) : 0}%` }}></div>
                            </div>
                        </div>
                        <div>
                            <div className="flex justify-between text-sm mb-1.5">
                                <span className="text-slate-400 flex items-center gap-2"><MemoryStick size={14} /> RAM Usage</span>
                                <span className="text-white font-semibold">{stats ? `${formatBytes(stats.memory)} / ${server.maxRamMb} MB` : `0 MB / ${server.maxRamMb} MB`}</span>
                            </div>
                            <div className="w-full bg-black/40 rounded-full h-2 border border-white/5 overflow-hidden">
                                <div className="bg-purple-500 h-2 rounded-full" style={{ width: `${stats ? Math.min((stats.memory / (server.maxRamMb * 1024 * 1024)) * 100, 100) : 0}%` }}></div>
                            </div>
                        </div>
                        <div className="pt-2 border-t border-white/[0.04]">
                            <div className="flex justify-between text-sm py-2">
                                <span className="text-slate-400 flex items-center gap-2"><Users size={14} /> Players</span>
                                <span className="text-white font-semibold">0 / 20</span>
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
    );
};
