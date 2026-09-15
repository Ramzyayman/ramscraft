import toast from 'react-hot-toast';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { Database, RefreshCw, Trash, Plus, AlertTriangle, Upload, X } from 'lucide-react';
import { socket } from '../../App';
import { useServersStore } from '../../store/useServersStore';

interface UploadState {
    name: string;
    size: number;
    sent: number;
    state: 'uploading' | 'processing';
    phase: string;
    percent: number;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const formatBytes = (b: number) => b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`;
// upload_<time>_<name>.tar.gz -> <name>
const uploadedLabel = (file: string) => file.match(/^upload_\d+_(.+)\.tar\.gz$/)?.[1];

export const Backups = () => {
    const { id } = useParams();
    const server = useServersStore(s => s.servers.find(srv => srv.id === id));
    const [backups, setBackups] = useState<any[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const [restoringFile, setRestoringFile] = useState<string | null>(null);
    const [showRestoreModal, setShowRestoreModal] = useState<string | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);
    // Live progress from the backend's `backupProgress` socket event.
    const [progress, setProgress] = useState<{ operation: 'create' | 'restore'; phase: string; percent: number } | null>(null);
    const [upload, setUpload] = useState<UploadState | null>(null);
    const uploadRef = useRef<{ id: string | null; cancelled: boolean; controller: AbortController | null }>({ id: null, cancelled: false, controller: null });
    const fileInput = useRef<HTMLInputElement>(null);

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

    // Closing the tab mid-upload loses the upload: ask first.
    useEffect(() => {
        if (upload?.state !== 'uploading') return;
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [upload?.state]);

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
            const { data } = await axios.post(`/api/servers/${id}/backups/${file}/restore`);
            const sw = data.software;
            const detected = sw ? ` Detected ${sw.providerName} ${sw.mcVersion}${sw.java ? `, using Java ${sw.java}` : ''}.` : '';
            toast.success(`Backup restored.${detected}`, { id: toastId, duration: 6000 });
            if (data.warning) toast(data.warning, { icon: '⚠️', duration: 10000 });
            useServersStore.getState().fetchServers();
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

    // Uploads go in chunks (Cloudflare allows 100 MB per request); a failed chunk is retried from where the server is.
    const handleUpload = async (file: File) => {
        if (!/\.(zip|tar\.gz|tgz)$/i.test(file.name)) {
            toast.error('Choose a .zip (or .tar.gz) of your server folder.');
            return;
        }
        const ref = uploadRef.current;
        ref.cancelled = false;
        setUpload({ name: file.name, size: file.size, sent: 0, state: 'uploading', phase: 'Uploading', percent: 0 });
        try {
            const { data } = await axios.post(`/api/servers/${id}/backups/upload`, { filename: file.name, size: file.size });
            ref.id = data.uploadId;
            const url = `/api/servers/${id}/backups/upload/${data.uploadId}`;

            let offset = 0, failures = 0;
            while (offset < file.size) {
                if (ref.cancelled) return;
                ref.controller = new AbortController();
                const start = offset;
                try {
                    const res = await axios.put(`${url}?offset=${start}`, file.slice(start, start + data.chunkSize), {
                        headers: { 'Content-Type': 'application/octet-stream' },
                        signal: ref.controller.signal,
                        timeout: 15 * 60_000,
                        onUploadProgress: e => setUpload(u => u && { ...u, sent: start + (e.loaded ?? 0) }),
                    });
                    offset = res.data.received;
                    failures = 0;
                } catch (e: any) {
                    if (ref.cancelled) return;
                    if (typeof e.response?.data?.received === 'number') offset = e.response.data.received;
                    // Network errors, 5xx and 409 (out of sync: resume at the server's offset) are retried; other refusals are final.
                    const status = e.response?.status ?? 0;
                    if ((status >= 400 && status < 500 && status !== 409) || status === 507 || ++failures > 4) throw e;
                    await sleep(1500 * failures);
                }
                setUpload(u => u && { ...u, sent: offset });
            }

            setUpload(u => u && { ...u, state: 'processing', phase: 'Checking archive', percent: 0 });
            await axios.post(`${url}/complete`);
            for (;;) {
                await sleep(1500);
                const { data: status } = await axios.get(url);
                if (status.state === 'done') {
                    toast.success(`Uploaded ${file.name}. Restore it to use it on this server.`, { duration: 7000 });
                    await fetchBackups();
                    break;
                }
                if (status.state === 'error') throw new Error(status.error);
                setUpload(u => u && { ...u, phase: status.phase, percent: status.percent });
            }
        } catch (e: any) {
            if (!ref.cancelled) toast.error(e.response?.data?.error || e.message || 'Upload failed', { duration: 10000 });
        } finally {
            ref.id = null;
            ref.controller = null;
            setUpload(null);
            if (fileInput.current) fileInput.current.value = '';
        }
    };

    const cancelUpload = async () => {
        const ref = uploadRef.current;
        ref.cancelled = true;
        ref.controller?.abort();
        if (ref.id) await axios.delete(`/api/servers/${id}/backups/upload/${ref.id}`).catch(() => {});
        toast('Upload cancelled.');
    };

    const busy = isCreating || !!restoringFile || !!upload;

    return (
        <div className="max-w-5xl space-y-6 relative">
            {showRestoreModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="glass-panel w-full max-w-md p-6 rounded-xl border border-yellow-500/30">
                        <div className="flex items-center gap-3 mb-4 text-yellow-400">
                            <AlertTriangle size={24} />
                            <h3 className="text-lg font-semibold">Confirm Restoration</h3>
                        </div>
                        <p className="text-sm text-slate-300 mb-3 leading-relaxed">
                            <span className="font-bold text-yellow-400">RESTORE WARNING:</span> This will DELETE all current files and replace them with this backup. The server MUST be offline. Continue?
                        </p>
                        <p className="text-xs text-slate-400 mb-6 leading-relaxed">
                            RamsCraft detects the server software in the backup, picks a matching Java version and keeps this server's port{server ? ` (${server.port})` : ''}.
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
                <div className="p-5 border-b border-white/[0.04] bg-white/[0.02] flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h3 className="text-lg font-semibold text-white">Backups</h3>
                        <p className="text-sm text-slate-400 mt-1">Manage server backups and restoration points. Moving a server here? Upload a .zip of its folder, then restore it.</p>
                    </div>
                    <div className="flex gap-2">
                        <input
                            ref={fileInput}
                            type="file"
                            accept=".zip,.tar.gz,.tgz"
                            className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
                        />
                        <button onClick={() => fileInput.current?.click()} disabled={busy} className="glass-button bg-emerald-600/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-600/25 hover:text-white px-4 py-2 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                            <Upload size={16} />
                            Upload Backup
                        </button>
                        <button onClick={handleCreate} disabled={busy} className="glass-button bg-blue-600/20 text-blue-400 border-blue-500/30 hover:bg-blue-600/30 hover:text-white px-4 py-2 flex items-center gap-2 shadow-lg shadow-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed">
                            <Plus size={16} />
                            {isCreating ? 'Creating...' : 'Create Backup'}
                        </button>
                    </div>
                </div>

                {upload && (
                    <div className="p-5 border-b border-white/[0.04] bg-black/20">
                        <div className="flex justify-between items-center gap-4 text-sm mb-2">
                            <span className="text-slate-300 flex items-center gap-2 min-w-0">
                                <RefreshCw size={14} className="animate-spin text-emerald-400 shrink-0" />
                                <span className="truncate">
                                    {upload.state === 'uploading'
                                        ? `Uploading ${upload.name}: ${formatBytes(upload.sent)} of ${formatBytes(upload.size)}`
                                        : `Preparing ${upload.name}: ${upload.phase}...`}
                                </span>
                            </span>
                            <span className="flex items-center gap-3 shrink-0">
                                <span className="text-white font-mono">
                                    {upload.state === 'uploading' ? Math.floor(upload.sent / upload.size * 100) : upload.percent}%
                                </span>
                                {upload.state === 'uploading' && (
                                    <button onClick={cancelUpload} className="glass-button px-2 py-1 text-slate-400 hover:text-white flex items-center gap-1 text-xs">
                                        <X size={12} /> Cancel
                                    </button>
                                )}
                            </span>
                        </div>
                        <div className="w-full bg-black/40 rounded-full h-2 border border-white/5 overflow-hidden">
                            <div className="h-2 rounded-full transition-all duration-500 bg-emerald-500"
                                style={{ width: `${upload.state === 'uploading' ? Math.floor(upload.sent / upload.size * 100) : upload.percent}%` }} />
                        </div>
                        {upload.state === 'uploading' && <p className="text-xs text-slate-500 mt-2">Keep this page open until the upload finishes.</p>}
                    </div>
                )}

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
                            ) : backups.map((b, i) => {
                                const uploaded = uploadedLabel(b.name);
                                return (
                                    <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                                        <td className="px-6 py-4 flex items-center gap-3">
                                            <div className={`p-2 rounded-lg border ${uploaded ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-blue-500/10 border-blue-500/20'}`}>
                                                {uploaded ? <Upload size={18} className="text-emerald-400" /> : <Database size={18} className="text-blue-400" />}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold text-white truncate">{uploaded ?? b.name}</span>
                                                    {uploaded && <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5">Uploaded</span>}
                                                </div>
                                                {uploaded && <div className="text-xs text-slate-500 truncate">{b.name}</div>}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-400">{(b.size / 1024 / 1024).toFixed(2)} MB</td>
                                        <td className="px-6 py-4 text-slate-400">
                                            {new Date(b.createdAt).toLocaleString(undefined, {
                                                year: 'numeric', month: 'short', day: 'numeric',
                                                hour: '2-digit', minute: '2-digit'
                                            })}
                                        </td>
                                        <td className="px-6 py-4 text-right space-x-2">
                                            <button onClick={() => setShowRestoreModal(b.name)} disabled={busy} className="glass-button bg-yellow-500/10 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20 hover:text-yellow-300 px-3 py-1.5 inline-flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50">
                                                <RefreshCw size={14} className={restoringFile === b.name ? 'animate-spin' : ''} /> {restoringFile === b.name ? 'Restoring...' : 'Restore'}
                                            </button>
                                            <button onClick={() => setShowDeleteModal(b.name)} className="glass-button bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 hover:text-red-300 px-3 py-1.5 inline-flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Trash size={14} /> Delete
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
