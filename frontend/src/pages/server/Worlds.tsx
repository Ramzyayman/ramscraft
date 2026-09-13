import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Globe, Trash, UploadCloud } from 'lucide-react';

export const Worlds = () => {
    const { id } = useParams();
    const [worlds, setWorlds] = useState<any[]>([]);

    const fetchWorlds = async () => {
        try {
            const res = await axios.get(`http://192.168.1.6:3001/api/servers/${id}/files?path=/`);
            setWorlds(res.data.filter((f: any) => f.isDirectory));
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => { fetchWorlds(); }, [id]);

    const handleDelete = async (world: string) => {
        if (!confirm('Are you sure you want to delete world: ' + world + '? This is irreversible.')) return;
        try {
            await axios.delete(`http://192.168.1.6:3001/api/servers/${id}/files?path=/${world}`);
            fetchWorlds();
        } catch (e) {
            console.error('Delete failed');
        }
    };

    return (
        <div className="max-w-5xl space-y-6">
            <div className="glass-panel rounded-xl overflow-hidden">
                <div className="p-5 border-b border-white/[0.04] bg-white/[0.02] flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-white">Worlds & Data</h3>
                        <p className="text-sm text-slate-400 mt-1">Manage server worlds and top-level directory data.</p>
                    </div>
                </div>
                
                <div className="bg-black/20">
                    <table className="w-full text-left text-sm text-slate-300">
                        <thead className="bg-black/40 border-b border-white/[0.04]">
                            <tr>
                                <th className="px-6 py-3 font-semibold text-slate-400">Folder Name</th>
                                <th className="px-6 py-3 text-right font-semibold text-slate-400">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                            {worlds.length === 0 ? (
                                <tr>
                                    <td colSpan={2} className="px-6 py-12 text-center flex flex-col items-center">
                                        <div className="w-12 h-12 bg-black/40 rounded-full flex items-center justify-center mb-4 border border-white/5">
                                            <Globe size={20} className="text-slate-500" />
                                        </div>
                                        <p className="text-slate-400 font-medium">No world folders found.</p>
                                    </td>
                                </tr>
                            ) : worlds.map((w, i) => (
                                <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                                    <td className="px-6 py-4 flex items-center gap-3">
                                        <div className="bg-green-500/10 p-2 rounded-lg border border-green-500/20">
                                            <Globe size={18} className="text-green-400" />
                                        </div>
                                        <span className="font-semibold text-white">{w.name}</span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button onClick={() => handleDelete(w.name)} className="glass-button bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 hover:text-red-300 px-3 py-1.5 inline-flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Trash size={14} /> Delete
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
