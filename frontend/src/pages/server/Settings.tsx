import React from 'react';
import { useParams } from 'react-router-dom';
import { useServersStore } from '../../store/useServersStore';
import { Save } from 'lucide-react';

export const Settings = () => {
    const { id } = useParams<{id: string}>();
    const server = useServersStore(s => s.servers.find(srv => srv.id === id));

    if (!server) return null;

    return (
        <div className="max-w-4xl space-y-6">
            <div className="glass-panel rounded-xl overflow-hidden">
                <div className="p-5 border-b border-white/[0.04] bg-white/[0.02]">
                    <h3 className="text-lg font-semibold text-white">General Settings</h3>
                    <p className="text-sm text-slate-400 mt-1">Configure basic information for this server.</p>
                </div>
                
                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Server Name</label>
                            <input 
                                type="text" 
                                defaultValue={server.name}
                                className="w-full glass-input"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Port</label>
                            <input 
                                type="number" 
                                defaultValue={server.port}
                                className="w-full glass-input bg-black/20 text-slate-400 cursor-not-allowed"
                                disabled
                            />
                            <p className="text-xs text-slate-500 mt-2">Port cannot be changed after creation.</p>
                        </div>
                    </div>
                </div>
                
                <div className="p-5 border-t border-white/[0.04] bg-black/20 flex justify-end">
                    <button className="glass-button bg-blue-600/20 text-blue-400 border-blue-500/30 hover:bg-blue-600/30 hover:text-white px-6 py-2 flex items-center gap-2">
                        <Save size={16} />
                        Save Changes
                    </button>
                </div>
            </div>

            <div className="glass-panel rounded-xl overflow-hidden border-red-500/20">
                <div className="p-5 border-b border-red-500/10 bg-red-500/5">
                    <h3 className="text-lg font-semibold text-red-400">Danger Zone</h3>
                </div>
                
                <div className="p-6 flex items-center justify-between">
                    <div>
                        <h4 className="text-white font-medium mb-1">Delete Server</h4>
                        <p className="text-sm text-slate-400">Permanently remove this server and all its files. This action cannot be undone.</p>
                    </div>
                    <button className="glass-button bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20 hover:text-red-300 px-6 py-2">
                        Delete Server
                    </button>
                </div>
            </div>
        </div>
    );
};
