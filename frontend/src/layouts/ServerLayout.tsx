import React from 'react';
import { Outlet, Link, useLocation, useParams } from 'react-router-dom';
import { useServersStore } from '../store/useServersStore';
import { Terminal, Settings, Users, Box, Folder, Globe, Database, HardDrive } from 'lucide-react';

export const ServerLayout = () => {
    const { id } = useParams<{id: string}>();
    const location = useLocation();
    const server = useServersStore(s => s.servers.find(srv => srv.id === id));
    React.useEffect(() => { if (useServersStore.getState().servers.length === 0) useServersStore.getState().fetchServers(); }, []);

    if (!server) return null;

    const navItems = [
        { path: '', label: 'Overview', icon: <Box size={16} /> },
        { path: '/console', label: 'Console', icon: <Terminal size={16} /> },
        { path: '/settings', label: 'Settings', icon: <Settings size={16} /> },
        { path: '/players', label: 'Players', icon: <Users size={16} /> },
        { path: '/software', label: 'Software', icon: <HardDrive size={16} /> },
        { path: '/files', label: 'Files', icon: <Folder size={16} /> },
        { path: '/worlds', label: 'Worlds', icon: <Globe size={16} /> },
        { path: '/backups', label: 'Backups', icon: <Database size={16} /> },
    ];

    const getBadge = (status: string) => {
        switch (status) {
            case 'ONLINE': return <span className="bg-[#2ed573]/15 text-[#2ed573] text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase">ONLINE</span>;
            case 'OFFLINE': return <span className="bg-[#ff4757]/15 text-[#ff4757] text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase">OFFLINE</span>;
            case 'STARTING':
            case 'RECOVERING': return <span className="bg-white/10 text-slate-400 text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase">{status}</span>;
            case 'EULA_PENDING': return <span className="bg-blue-500/15 text-blue-400 text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase">EULA PENDING</span>;
            default: return <span className="bg-white/10 text-slate-400 text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase">{status}</span>;
        }
    };

    return (
        <div className="w-full flex flex-col gap-6">
            {/* Server Header */}
            <div className="glass-panel rounded-xl p-6">
                <div className="flex items-start justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-[#2b5876] to-[#4e4376] shadow-inner">
                            <Terminal size={28} className="text-white opacity-90" />
                        </div>
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <h1 className="text-2xl font-bold text-white tracking-tight">{server.name}</h1>
                                {getBadge(server.status)}
                            </div>
                            <p className="text-sm text-slate-400 capitalize">
                                {server.software?.provider || 'Unknown'} {server.software?.mcVersion || ''} &bull; Port {server.port}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Horizontal Navigation */}
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                    {navItems.map(item => {
                        const to = `/server/${server.id}${item.path}`;
                        const isActive = item.path === '' ? location.pathname === `/server/${server.id}` : location.pathname.startsWith(to);
                        
                        return (
                            <Link 
                                key={item.path}
                                to={to}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all shrink-0
                                    ${isActive 
                                        ? 'bg-white/10 text-white shadow-sm border border-white/10' 
                                        : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                                    }`}
                            >
                                {item.icon}
                                {item.label}
                            </Link>
                        );
                    })}
                </div>
            </div>

            {/* Sub-page Content */}
            <div className="w-full">
                <Outlet />
            </div>
        </div>
    );
};

