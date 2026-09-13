import React, { useEffect, useRef, useState } from 'react';
import { socket } from '../App';

export const Console = ({ serverId }: { serverId: string }) => {
    const [lines, setLines] = useState<string[]>([]);
    const [input, setInput] = useState('');
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleLog = (data: {serverId: string, line: string}) => {
            if (data.serverId === serverId) {
                setLines(prev => [...prev, data.line].slice(-1000));
            }
        };
        const handleHistory = (data: {serverId: string, history: string}) => {
            if (data.serverId === serverId) {
                setLines(data.history.split('\n').filter(l => l));
            }
        };

        socket.on('consoleLine', handleLog);
        socket.on('consoleHistory', handleHistory);

        socket.emit('subscribe:server', serverId);

        return () => {
            socket.off('consoleLine', handleLog);
            socket.off('consoleHistory', handleHistory);
            socket.emit('unsubscribe:server', serverId);
        };
    }, [serverId]);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [lines]);

    const handleCommand = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;
        socket.emit('sendCommand', { serverId, command: input });
        setInput('');
    };

    return (
        <div className="glass-panel rounded-xl flex flex-col h-[600px] overflow-hidden">
            <div className="p-4 border-b border-white/[0.04] bg-white/[0.02] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Live Console</h3>
                <div className="flex gap-2">
                    <button className="glass-button px-3 py-1 text-xs">Clear</button>
                    <button className="glass-button px-3 py-1 text-xs">Auto-scroll</button>
                </div>
            </div>
            
            <div className="flex-1 bg-[#050505]/90 overflow-y-auto p-4 font-mono text-sm">
                {lines.map((line, i) => (
                    <div key={i} className="mb-1 leading-relaxed text-gray-300 whitespace-pre-wrap break-all">
                        {line}
                    </div>
                ))}
                <div ref={endRef} />
            </div>

            <form onSubmit={handleCommand} className="p-3 bg-black/40 border-t border-white/5 flex gap-3">
                <input 
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="Enter a command (e.g. op player)"
                    className="flex-1 bg-black/40 border border-white/10 rounded-md text-white px-4 py-2.5 font-mono text-sm focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-gray-600"
                />
                <button type="submit" className="glass-button bg-blue-600/20 text-blue-400 border-blue-500/30 hover:bg-blue-600/30 hover:text-white px-6 font-semibold">
                    Send
                </button>
            </form>
        </div>
    );
};
