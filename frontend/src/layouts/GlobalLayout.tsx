import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Server } from 'lucide-react';

export const GlobalLayout = () => {
    return (
        <div className="min-h-screen text-slate-200 font-sans flex flex-col">
            <div className="bg-ramses"></div>
            
            {/* Top Navigation */}
            <header className="glass-panel border-x-0 border-t-0 border-b border-white/[0.06] sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-3">
                        <Server className="text-blue-400" size={24} />
                        <span className="font-bold text-xl tracking-tight text-white drop-shadow-md">
                            RamsCraft
                        </span>
                    </Link>
                    
                    <nav className="flex items-center gap-6">
                        <Link to="/" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">
                            Servers
                        </Link>
                        <a href="http://ramesseshub.site" className="glass-button px-4 py-2">
                            Back to Hub
                        </a>
                    </nav>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 w-full max-w-7xl mx-auto p-6 mt-4">
                <Outlet />
            </main>
        </div>
    );
};
