import toast from 'react-hot-toast';
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Database, RefreshCw, Trash, Plus, AlertTriangle } from 'lucide-react';
import { socket } from '../../App';

export const Backups = () => {
    const { id } = useParams();
    const [backups, setBackups] = useState<any[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const [restoringFile, setRestoringFile] = useState<string | null>(null);
    const [showRestoreModal, setShowRestoreModal] = useState<string | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);
    // Live progress from the backend's `backupProgress` socket event.
    const [progress, setProgress] = useState<{ operation: 'create' | 'restore'; phase: string; percent: number } | null>(null);

    const fetchBackups = async () => {
        try {
            const res = await axios.get(`/api/servers/${id}/backups`);
            setBackups(res.data);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => { fetchBackups(); }, [id]);

    useEffect(() => {
        const onProgress = (data: any) => {
            if (data.serverId === id) setProgress({ operation: data.operation, phase: data.phase, percent: data.percent });
        };
        socket.on('backupProgress', onProgress);
        return () => { socket.off('backupProgress', onProgress); };
    }, [id]);

    const handleCreate = async () => {
        setIsCreating(true);
        const toastId = toast.loading('Creating backup...');
        try {
            await axios.post(`/api/servers/${id}/backups`);
            toast.success('Backup completed successfully!', { id: toastId });
            fetchBackups();
        } catch (e: any) {
            toast.error(e.response?.data?.error || 'Failed to start backup', { id: toastId });
        } finally {
            setIsCreating(false);
            setProgress(null);
        }
    };
    
    const handleRestore = async (file: string) => {
        setShowRestoreModal(null);
        setRestoringFile(file);
        const toastId = toast.loading(`Restoring backup ${file}...`);
        try {
            await axios.post(`/api/servers/${id}/backups/${file}/restore`);
            toast.success('Backup restored successfully!', { id: toastId });
        } catch (e: any) {
            toast.error(e.response?.data?.error || 'Restore failed', { id: toastId });
        } finally {
            setRestoringFile(null);
            setProgress(null);
        }
    };

    const handleDelete = async (file: string) => {
        setShowDeleteModal(null);
        const toastId = toast.loading(`Deleting backup ${file}...`);
        try {
            await axios.delete(`/api/servers/${id}/backups/${file}`);
            toast.success('Backup deleted successfully!', { id: toastId });
            fetchBackups();
        } catch (e: any) {
            toast.error(e.response?.data?.error || 'Delete failed', { id: toastId });
        }
    };

    return (
        <div className="max-w-5xl space-y-6 relative">
            {showRestoreModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="glass-panel w-full max-w-md p-6 rounded-xl border border-yellow-500/30">
                        <div className="flex items-center gap-3 mb-4 text-yellow-400">
                            <AlertTriangle size={24} />
                            <h3 className="text-lg font-semibold">Confirm Restoration</h3>
                        </div>
                        <p className="text-sm text-slate-300 mb-6 leading-relaxed">
                            <span className="font-bold text-yellow-400">RESTORE WARNING:</span> This will DELETE all current files and replace them with this backup. The server MUST be offline. Continue?
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button 
                                onClick={() => setShowRestoreModal(null)}
                                className="glass-button px-4 py-2 text-slate-300 hover:text-white"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={() => handleRestore(showRestoreModal)}
                                className="glass-button bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 border-yellow-500/30 px-4 py-2"
                            >
                                Continue Restore
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showDeleteModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="glass-panel w-full max-w-md p-6 rounded-xl border border-red-500/30">
                        <div className="flex items-center gap-3 mb-4 text-red-400">
                            <AlertTriangle size={24} />
                            <h3 className="text-lg font-semibold">Delete Backup</h3>
                        </div>
                        <p className="text-sm text-slate-300 mb-6 leading-relaxed">
                            Are you sure you want to permanently delete this backup? This action cannot be undone.
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button 
                                onClick={() => setShowDeleteModal(null)}
                                className="glass-button px-4 py-2 text-slate-300 hover:text-white"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={() => handleDelete(showDeleteModal)}
                                className="glass-button bg-red-500/20 text-red-400 hover:bg-red-500/30 border-red-500/30 px-4 py-2"
                            >
                                Delete Backup
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="glass-panel rounded-xl overflow-hidden">
                <div className="p-5 border-b border-white/[0.04] bg-white/[0.02] flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-white">Backups</h3>
                        <p className="text-sm text-slate-400 mt-1">Manage server backups and restoration points.</p>
                    </div>
                    <button onClick={handleCreate} disabled={isCreating || !!restoringFile} className="glass-button bg-blue-600/20 text-blue-400 border-blue-500/30 hover:bg-blue-600/30 hover:text-white px-4 py-2 flex items-center gap-2 shadow-lg shadow-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed">
                        <Plus size={16} />
                        {isCreating ? 'Creating...' : 'Create Backup'}
                    </button>
                </div>
                
                {progress && (
                    <div className="p-5 border-b border-white/[0.04] bg-black/20">
                        <div className="flex justify-between text-sm mb-2">
                            <span className="text-slate-300 flex items-center gap-2">
                                <RefreshCw size={14} className="animate-spin text-blue-400" />
                                {progress.operation === 'create' ? 'Creating backup' : 'Restoring backup'}: {progress.phase}...
                            </span>
                            <span className="text-white font-mono">{progress.percent}%</span>
                        </div>
                        <div className="w-full bg-black/40 rounded-full h-2 border border-white/5 overflow-hidden">
                            <div className={`h-2 rounded-full transition-all duration-500 ${progress.operation === 'create' ? 'bg-blue-500' : 'bg-yellow-500'}`}
                                style={{ width: `${progress.percent}%` }} />
                        </div>
                    </div>
                )}

                <div className="bg-black/20">
                    <table className="w-full text-left text-sm text-slate-300">
                        <thead className="bg-black/40 border-b border-white/[0.04]">
                            <tr>
                                <th className="px-6 py-3 font-semibold text-slate-400">Filename</th>
                                <th className="px-6 py-3 font-semibold text-slate-400">Size</th>
                                <th className="px-6 py-3 font-semibold text-slate-400">Created At</th>
                                <th className="px-6 py-3 text-right font-semibold text-slate-400">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                            {backups.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-6">
                                        <div className="flex flex-col items-center justify-center py-12">
                                            <div className="w-12 h-12 bg-black/40 rounded-full flex items-center justify-center mb-4 border border-white/5">
                                                <Database size={20} className="text-slate-500" />
                                            </div>
                                            <p className="text-slate-400 font-medium">No backups found.</p>
                                        </div>
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
                                    <td className="px-6 py-4 text-slate-400">
                                        {new Date(b.createdAt).toLocaleString(undefined, { 
                                            year: 'numeric', month: 'short', day: 'numeric', 
                                            hour: '2-digit', minute: '2-digit' 
                                        })}
                                    </td>
                                    <td className="px-6 py-4 text-right space-x-2">
                                        <button onClick={() => setShowRestoreModal(b.name)} disabled={!!restoringFile || isCreating} className="glass-button bg-yellow-500/10 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20 hover:text-yellow-300 px-3 py-1.5 inline-flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50">
                                            <RefreshCw size={14} className={restoringFile === b.name ? 'animate-spin' : ''} /> {restoringFile === b.name ? 'Restoring...' : 'Restore'}
                                        </button>
                                        <button onClick={() => setShowDeleteModal(b.name)} className="glass-button bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 hover:text-red-300 px-3 py-1.5 inline-flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
