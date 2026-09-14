import toast from 'react-hot-toast';
import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { File, Folder, Trash, Upload, Search, CornerLeftUp, Download, Edit2, Archive, Save, X, Plus } from 'lucide-react';
import { useDialog } from '../../components/Dialog';

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export const Files = () => {
    const { id } = useParams();
    const [path, setPath] = useState('/');
    const { dialog, confirm, prompt } = useDialog();
    const [files, setFiles] = useState<any[]>([]);
    
    // Editor State
    const [editingFile, setEditingFile] = useState<string | null>(null);
    const [fileContent, setFileContent] = useState('');
    const [saving, setSaving] = useState(false);
    
    // Upload refs
    const fileInputRef = useRef<HTMLInputElement>(null);
    const zipInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);

    const fetchFiles = async () => {
        try {
            const res = await axios.get(`/api/servers/${id}/files?path=${path}`);
            setFiles(res.data);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => { 
        if (!editingFile) {
            fetchFiles(); 
        }
    }, [path, id, editingFile]);

    const handleNavigate = (file: any) => {
        if (file.isDirectory) {
            setPath(prev => prev === '/' ? `/${file.name}` : `${prev}/${file.name}`);
        } else {
            // Check if text file to edit
            const ext = file.name.split('.').pop()?.toLowerCase();
            const textExts = ['txt', 'json', 'yml', 'yaml', 'properties', 'log', 'sh', 'bat'];
            if (textExts.includes(ext || '')) {
                openEditor(file.name);
            }
        }
    };
    
    const goUp = () => {
        if (path === '/') return;
        const parts = path.split('/');
        parts.pop();
        setPath(parts.join('/') || '/');
    };

    const handleDelete = async (e: React.MouseEvent, file: any) => {
        e.stopPropagation();
        if (!(await confirm({
            title: `Delete ${file.isDirectory ? 'Folder' : 'File'}`,
            message: <>Permanently delete <span className="font-semibold text-white">{file.name}</span>{file.isDirectory ? ' and everything inside it' : ''}? This cannot be undone.</>,
            confirmLabel: 'Delete',
            tone: 'danger',
        }))) return;
        const targetPath = path === '/' ? `/${file.name}` : `${path}/${file.name}`;
        try {
            await axios.delete(`/api/servers/${id}/files?path=${targetPath}`);
            toast.success(`Deleted ${file.name}`);
            fetchFiles();
        } catch (e: any) {
            toast.error(e.response?.data?.error || 'Delete failed');
        }
    };

    const handleDownload = (e: React.MouseEvent, file: any) => {
        e.stopPropagation();
        const targetPath = path === '/' ? `/${file.name}` : `${path}/${file.name}`;
        window.open(`/api/servers/${id}/files?path=${encodeURIComponent(targetPath)}&action=download`, '_blank');
    };

    const openEditor = async (filename: string) => {
        const targetPath = path === '/' ? `/${filename}` : `${path}/${filename}`;
        try {
            const res = await axios.get(`/api/servers/${id}/files/content?path=${targetPath}`);
            setFileContent(res.data.content);
            setEditingFile(filename);
        } catch (e: any) {
            toast.error(e.response?.data?.error || 'Failed to open file');
        }
    };

    const saveEditor = async () => {
        if (!editingFile) return;
        setSaving(true);
        const targetPath = path === '/' ? `/${editingFile}` : `${path}/${editingFile}`;
        try {
            await axios.post(`/api/servers/${id}/files/content?path=${targetPath}`, { content: fileContent });
            toast.success(`Saved ${editingFile}`);
            setEditingFile(null);
        } catch (e: any) {
            toast.error(e.response?.data?.error || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const createFolder = async () => {
        const name = await prompt({ title: 'New Folder', confirmLabel: 'Create', input: { placeholder: 'Folder name' } });
        if (!name) return;
        const targetPath = path === '/' ? `/${name}` : `${path}/${name}`;
        try {
            await axios.post(`/api/servers/${id}/files/folder?path=${targetPath}`);
            toast.success(`Created folder ${name}`);
            fetchFiles();
        } catch (e: any) {
            toast.error(e.response?.data?.error || 'Failed to create folder');
        }
    };

    const renameFile = async (e: React.MouseEvent, file: any) => {
        e.stopPropagation();
        const newName = await prompt({ title: `Rename ${file.name}`, confirmLabel: 'Rename', input: { defaultValue: file.name } });
        if (!newName || newName === file.name) return;
        const targetPath = path === '/' ? `/${newName}` : `${path}/${newName}`;
        const sourcePath = path === '/' ? `/${file.name}` : `${path}/${file.name}`;
        try {
            await axios.put(`/api/servers/${id}/files/move?path=${sourcePath}`, { targetPath });
            toast.success(`Renamed to ${newName}`);
            fetchFiles();
        } catch (e: any) {
            toast.error(e.response?.data?.error || 'Rename failed');
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        
        const formData = new FormData();
        Array.from(e.target.files).forEach(f => {
            formData.append('files', f);
            // Some browsers provide webkitRelativePath for folder uploads
            formData.append('paths', f.webkitRelativePath || f.name);
        });

        try {
            await axios.post(`/api/servers/${id}/files/upload?path=${path}`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            toast.success('Upload complete');
            fetchFiles();
        } catch (err) {
            toast.error('Upload failed');
        }
        
        if (e.target) e.target.value = '';
    };

    const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const formData = new FormData();
        formData.append('file', e.target.files[0]);
        
        try {
            await axios.post(`/api/servers/${id}/files/extract?path=${path}`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            toast.success('Zip uploaded and extracted');
            fetchFiles();
        } catch (err) {
            toast.error('Upload and extraction failed');
        }
        if (e.target) e.target.value = '';
    };
    const handleExtract = async (e: React.MouseEvent, file: any) => {
        e.stopPropagation();
        // No endpoint extracts an already-uploaded zip yet (POST /extract takes an upload), so don't ask first.
        toast.error(`Extracting ${file.name} on the server isn't supported yet. Use "Upload Zip" to upload and extract it instead.`);
    };

    if (editingFile) {
        return (
            <div className="max-w-5xl space-y-4">
                <div className="flex items-center justify-between bg-black/40 p-4 rounded-xl border border-white/5">
                    <div className="text-white font-medium flex items-center gap-2">
                        <Edit2 size={16} className="text-blue-400" />
                        {editingFile}
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => setEditingFile(null)} className="glass-button px-4 py-2 hover:bg-white/5">Cancel</button>
                        <button onClick={saveEditor} disabled={saving} className="glass-button bg-blue-500/20 text-blue-300 border-blue-500/30 px-4 py-2 flex gap-2">
                            <Save size={16}/> {saving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>
                <textarea 
                    value={fileContent}
                    onChange={e => setFileContent(e.target.value)}
                    className="w-full h-[600px] bg-[#0d1117] text-slate-300 font-mono p-4 rounded-xl border border-white/5 focus:outline-none focus:border-blue-500/50"
                    spellCheck="false"
                />
            </div>
        );
    }

    return (
        <div className="max-w-5xl space-y-6">
            {dialog}
            <div className="glass-panel rounded-xl overflow-hidden">
                <div className="p-5 border-b border-white/[0.04] bg-white/[0.02] flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-white">File Manager</h3>
                        <p className="text-sm text-slate-400 mt-1">Browse and manage server files directly.</p>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={createFolder} className="glass-button px-4 py-2 flex items-center gap-2"><Plus size={16}/> Folder</button>
                        
                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" multiple />
                        <button onClick={() => fileInputRef.current?.click()} className="glass-button bg-blue-500/10 text-blue-400 border-blue-500/20 px-4 py-2 flex items-center gap-2">
                            <Upload size={16}/> Upload Files
                        </button>
                        <input type="file" accept=".zip" ref={zipInputRef} onChange={handleZipUpload} className="hidden" />
                        <button onClick={() => zipInputRef.current?.click()} className="glass-button bg-purple-500/10 text-purple-400 border-purple-500/20 px-4 py-2 flex items-center gap-2">
                            <Archive size={16}/> Upload & Extract Zip
                        </button>
                    </div>
                </div>
                
                <div className="bg-black/20">
                    <div className="p-4 border-b border-white/[0.04] bg-black/40 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 text-slate-300 font-mono text-sm bg-black/40 border border-white/10 px-4 py-2 rounded-md flex-1">
                            <button onClick={goUp} disabled={path === '/'} className="text-slate-500 hover:text-white disabled:opacity-30 disabled:hover:text-slate-500 transition-colors mr-2">
                                <CornerLeftUp size={16} />
                            </button>
                            <span className="truncate">{path}</span>
                        </div>
                    </div>
                    
                    <table className="w-full text-left text-sm text-slate-300">
                        <tbody className="divide-y divide-white/[0.04]">
                            {files.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                                        This directory is empty.
                                    </td>
                                </tr>
                            ) : files.map((f, i) => (
                                <tr key={i} onClick={() => handleNavigate(f)} className="hover:bg-white/[0.02] transition-colors cursor-pointer group">
                                    <td className="px-6 py-3.5 flex items-center gap-3">
                                        {f.isDirectory ? <Folder size={18} className="text-blue-400" /> : <File size={18} className="text-slate-400" />}
                                        <span className="font-semibold text-white">{f.name}</span>
                                    </td>
                                    <td className="px-6 py-3.5 text-slate-500">{f.isDirectory ? '--' : formatBytes(f.size)}</td>
                                    <td className="px-6 py-3.5 text-right opacity-0 group-hover:opacity-100 transition-opacity space-x-2">
                                        <button onClick={(e) => renameFile(e, f)} className="glass-button p-2 text-slate-400 hover:text-white" title="Rename"><Edit2 size={14}/></button>
                                        <button onClick={(e) => handleDownload(e, f)} className="glass-button p-2 text-slate-400 hover:text-white" title="Download"><Download size={14}/></button>
                                        <button onClick={(e) => handleDelete(e, f)} className="glass-button bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 hover:text-red-300 p-2 rounded-md">
                                            <Trash size={14} />
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

