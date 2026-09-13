import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Database, RefreshCw, Trash, Plus } from 'lucide-react';

export const Backups = () => {
    const { id } = useParams();
    const [backups, setBackups] = useState<any[]>([]);

    const fetchBackups = async () => {
        try {
            const res = await axios.get(`http://192.168.1.6:3001/api/servers/${id}/backups`);
            setBackups(res.data);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => { fetchBackups(); }, [id]);

    const handleCreate = async () => {
        try {
            await axios.post(`http://192.168.1.6:3001/api/servers/${id}/backups`);
            // alert('Backup started in background!');
            setTimeout(fetchBackups, 2000);
        } catch (e) {
            console.error('Failed to start backup');
        }
    };
    
    const handleRestore = async (file: string) => {
        if (!confirm('RESTORE WARNING: This will DELETE all current files and replace them with this backup. The server MUST be offline. Continue?')) return;
        try {
            await axios.post(`http://192.168.1.6:3001/api/servers/${id}/backups/${file}/restore`);
            // alert('Restore started in background!');
        } catch (e: any) {
            console.error('Restore failed: ' + (e.response?.data?.error || e.message));
        }
    };

    return (
        <div className="max-w-5xl space-y-6">
            <div className="glass-panel rounded-xl overflow-hidden">
                <div className="p-5 border-b border-white/[0.04] bg-white/[0.02] flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-white">Backups</h3>
                        <p className="text-sm text-slate-400 mt-1">Manage server backups and restoration points.</p>
                    </div>
                    <button onClick={handleCreate} className="glass-button bg-blue-600/20 text-blue-400 border-blue-500/30 hover:bg-blue-600/30 hover:text-white px-4 py-2 flex items-center gap-2 shadow-lg shadow-blue-900/20">
                        <Plus size={16} />
                        Create Backup
                    </button>
                </div>
                
                <div className="bg-black/20">
                    <table className="w-full text-left text-sm text-slate-300">
                        <thead className="bg-black/40 border-b border-white/[0.04]">
                            <tr>
                                <th className="px-6 py-3 font-semibold text-slate-400">Filename</th>
                                <th className="px-6 py-3 font-semibold text-slate-400">Size</th>
                                <th className="px-6 py-3 text-right font-semibold text-slate-400">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                            {backups.length === 0 ? (
                                <tr>
                                    <td colSpan={3} className="px-6 py-12 text-center flex flex-col items-center">
                                        <div className="w-12 h-12 bg-black/40 rounded-full flex items-center justify-center mb-4 border border-white/5">
                                            <Database size={20} className="text-slate-500" />
                                        </div>
                                        <p className="text-slate-400 font-medium">No backups found.</p>
                                    </td>
                                </tr>
                            ) : backups.map((b, i) => (
                                <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                                    <td className="px-6 py-4 flex items-center gap-3">
                                        <div className="bg-blue-500/10 p-2 rounded-lg border border-blue-500/20">
                                            <Database size={18} className="text-blue-400" />
                                        </div>
                                        <span className="font-semibold text-white">{b.name}</span>
                                    </td>
                                    <td className="px-6 py-4 text-slate-400">{(b.size / 1024 / 1024).toFixed(2)} MB</td>
                                    <td className="px-6 py-4 text-right">
                                        <button onClick={() => handleRestore(b.name)} className="glass-button bg-yellow-500/10 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20 hover:text-yellow-300 px-3 py-1.5 inline-flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <RefreshCw size={14} /> Restore
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
