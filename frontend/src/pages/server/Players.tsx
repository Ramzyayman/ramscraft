import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { ShieldAlert, LogOut, User, Users } from 'lucide-react';

export const Players = () => {
    const { id } = useParams();
    const [players, setPlayers] = useState<any[]>([]);
    const [onlineCount, setOnlineCount] = useState(0);
    const [maxCount, setMaxCount] = useState(0);
    const [loading, setLoading] = useState(true);

    const fetchPlayers = async () => {
        try {
            const res = await axios.get(`http://192.168.1.6:3001/api/servers/${id}/players`);
            setOnlineCount(res.data.online);
            setMaxCount(res.data.max);
            setPlayers(res.data.sample);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPlayers();
        const intv = setInterval(fetchPlayers, 5000);
        return () => clearInterval(intv);
    }, [id]);

    const executeCommand = async (command: string, player: string) => {
        try {
            await axios.post(`http://192.168.1.6:3001/api/servers/${id}/players/command`, { command, player });
            // alert(`Executed ${command} on ${player}`);
        } catch (e) {
            console.error('Command failed');
        }
    };

    return (
        <div className="max-w-5xl space-y-6">
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
                                    <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                                        <td className="px-6 py-4 flex items-center gap-3">
                                            <img src={`https://minotar.net/avatar/${p.name}/32`} alt={p.name} className="w-8 h-8 rounded-md bg-black/50 border border-white/10" onError={(e) => (e.currentTarget.style.display = 'none')} />
                                            <span className="font-semibold text-white">{p.name}</span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
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
        </div>
    );
};
