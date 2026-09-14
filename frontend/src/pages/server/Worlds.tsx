import toast from 'react-hot-toast';
import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Globe, Download, Trash, Plus, Upload, AlertTriangle } from 'lucide-react';

export const Worlds = () => {
    const { id } = useParams();
    const [worlds, setWorlds] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [server, setServer] = useState<any>(null);
    const [properties, setProperties] = useState<any>({});
    const [showGeneratePrompt, setShowGeneratePrompt] = useState(false);
    const zipInputRef = useRef<HTMLInputElement>(null);

    const fetchData = async () => {
        try {
            const [srvRes, wRes, propRes] = await Promise.all([
                axios.get(`/api/servers/${id}`),
                axios.get(`/api/servers/${id}/worlds`),
                axios.get(`/api/servers/${id}/settings`)
            ]);
            setServer(srvRes.data);
            setWorlds(wRes.data);
            setProperties(propRes.data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, [id]);

    const currentLevelName = properties['level-name'] || 'world';

    const handleDownload = (name: string) => {
        window.open(`/api/servers/${id}/files?path=/${name}&action=download`, '_blank');
    };

    const handleDelete = async (name: string) => {
        if (server?.status !== 'OFFLINE') {
            toast.error('Server must be OFFLINE to delete a world.');
            return;
        }
        
        const toastId = toast.loading(`Deleting world '${name}'...`);
        try {
            await axios.delete(`/api/servers/${id}/files?path=/${name}`);
            toast.success('World deleted successfully.', { id: toastId });
            fetchData();
        } catch (err: any) {
            toast.error(err.response?.data?.error || 'Failed to delete world', { id: toastId });
        }
    };

    const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return;
        if (server?.status !== 'OFFLINE') {
            toast.error('Server must be OFFLINE to import a world.');
            return;
        }
        
        const file = e.target.files[0];
        const fd = new FormData();
        fd.append('file', file);
        
        const toastId = toast.loading('Uploading and importing world...');
        try {
            await axios.post(`/api/servers/${id}/worlds/import`, fd, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            toast.success('World imported and overwritten successfully.', { id: toastId });
            fetchData();
        } catch (err: any) {
            toast.error(err.response?.data?.error || 'Import failed', { id: toastId });
        }
        
        if (zipInputRef.current) zipInputRef.current.value = '';
    };

    const requestCreateWorld = () => {
        if (server?.status !== 'OFFLINE') {
            toast.error('Server must be OFFLINE to safely generate a new world.');
            return;
        }
        setShowGeneratePrompt(true);
    };

    const confirmCreateWorld = async () => {
        setShowGeneratePrompt(false);
        const toastId = toast.loading(`Generating new world in the background. This may take a minute...`);
        try {
            await axios.post(`/api/servers/${id}/worlds/generate`, {});
            toast.success('World generated successfully!', { id: toastId });
            fetchData();
        } catch (err: any) {
            toast.error(err.response?.data?.error || 'Generation failed', { id: toastId });
        }
    };

    if (!server) return null;

    return (
        <div className="max-w-5xl space-y-6">
            {showGeneratePrompt && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="glass-panel w-full max-w-md p-6 rounded-xl border border-orange-500/30 shadow-2xl relative">
                        <div className="flex items-center gap-3 mb-4 text-orange-400">
                            <AlertTriangle size={24} />
                            <h3 className="text-lg font-semibold">Generate New World</h3>
                        </div>
                        <p className="text-sm text-slate-300 mb-6 leading-relaxed">
                            <span className="font-bold text-orange-400">WARNING:</span> Generating a new world will permanently wipe and delete all existing world data on this server to avoid conflicts. This action cannot be undone. Are you sure you want to proceed?
                        </p>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setShowGeneratePrompt(false)} className="glass-button px-4 py-2 text-sm text-slate-300 hover:text-white">
                                Cancel
                            </button>
                            <button onClick={confirmCreateWorld} className="glass-button px-4 py-2 text-sm bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-all flex items-center gap-2">
                                <Plus size={16} /> Yes, Generate
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="glass-panel rounded-xl overflow-hidden">
                <div className="p-5 border-b border-white/[0.04] bg-white/[0.02] flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                            <Globe size={18} className="text-blue-400" /> Worlds
                        </h3>
                        <p className="text-sm text-slate-400 mt-1">Manage, generate, and import your Minecraft world.</p>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => zipInputRef.current?.click()} className="glass-button px-4 py-2 flex items-center gap-2">
                            <Upload size={16} /> Upload Zip
                        </button>
                        <button onClick={requestCreateWorld} className="glass-button bg-blue-600/20 text-blue-400 border-blue-500/30 hover:bg-blue-600/30 px-4 py-2 flex items-center gap-2">
                            <Plus size={16} /> Generate New
                        </button>
                        <input type="file" ref={zipInputRef} accept=".zip" className="hidden" onChange={handleZipUpload} />
                    </div>
                </div>
                
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-white/[0.04] bg-black/20 text-xs uppercase tracking-wider text-slate-500 font-semibold">
                                <th className="px-6 py-4">World Name</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                            {loading ? (
                                <tr>
                                    <td colSpan={2} className="px-6 py-12 text-center text-slate-400">Loading worlds...</td>
                                </tr>
                            ) : worlds.length === 0 ? (
                                <tr>
                                    <td colSpan={2} className="px-6 py-12">
                                        <div className="flex flex-col items-center text-center">
                                            <div className="w-12 h-12 bg-black/40 rounded-full flex items-center justify-center mb-4 border border-white/5">
                                                <Globe size={20} className="text-slate-500" />
                                            </div>
                                            <p className="text-slate-400 font-medium">No worlds found. Generate one or start the server.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : worlds.map((w, i) => (
                                <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                                    <td className="px-6 py-4 flex items-center gap-3">
                                        <Globe size={18} className={w.name === currentLevelName ? "text-emerald-400" : "text-slate-400"} />
                                        <div>
                                            <div className="font-semibold text-white">{w.name} {w.name === currentLevelName && <span className="ml-2 text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded uppercase">Current</span>}</div>
                                            <div className="text-xs text-slate-500">{(w.size / 1024 / 1024).toFixed(2)} MB</div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right space-x-2">
                                        <button onClick={() => handleDownload(w.name)} className="glass-button p-2 text-slate-400 hover:text-white" title="Download">
                                            <Download size={14}/>
                                        </button>
                                        <button onClick={() => handleDelete(w.name)} className="glass-button p-2 text-red-400/50 hover:text-red-400 hover:bg-red-500/10 border-red-500/10" title="Delete">
                                            <Trash size={14}/>
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
