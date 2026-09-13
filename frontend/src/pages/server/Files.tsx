import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { File, Folder, Trash, Upload, Search, CornerLeftUp } from 'lucide-react';

export const Files = () => {
    const { id } = useParams();
    const [path, setPath] = useState('/');
    const [files, setFiles] = useState<any[]>([]);

    const fetchFiles = async () => {
        try {
            const res = await axios.get(`http://192.168.1.6:3001/api/servers/${id}/files?path=${path}`);
            setFiles(res.data);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => { fetchFiles(); }, [path, id]);

    const handleNavigate = (file: any) => {
        if (file.isDirectory) {
            setPath(prev => prev === '/' ? `/${file.name}` : `${prev}/${file.name}`);
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
        if (!confirm('Delete ' + file.name + '?')) return;
        const targetPath = path === '/' ? `/${file.name}` : `${path}/${file.name}`;
        try {
            await axios.delete(`http://192.168.1.6:3001/api/servers/${id}/files?path=${targetPath}`);
            fetchFiles();
        } catch (e) {
            console.error('Delete failed');
        }
    };

    return (
        <div className="max-w-5xl space-y-6">
            <div className="glass-panel rounded-xl overflow-hidden">
                <div className="p-5 border-b border-white/[0.04] bg-white/[0.02] flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-white">File Manager</h3>
                        <p className="text-sm text-slate-400 mt-1">Browse and manage server files directly.</p>
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
                                    <td colSpan={3} className="px-6 py-8 text-center text-slate-500">
                                        This directory is empty.
                                    </td>
                                </tr>
                            ) : files.map((f, i) => (
                                <tr key={i} onClick={() => handleNavigate(f)} className="hover:bg-white/[0.02] transition-colors cursor-pointer group">
                                    <td className="px-6 py-3.5 flex items-center gap-3">
                                        {f.isDirectory ? <Folder size={18} className="text-blue-400" /> : <File size={18} className="text-slate-400" />}
                                        <span className="font-semibold text-white">{f.name}</span>
                                    </td>
                                    <td className="px-6 py-3.5 text-slate-500">{f.size} B</td>
                                    <td className="px-6 py-3.5 text-right opacity-0 group-hover:opacity-100 transition-opacity">
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
