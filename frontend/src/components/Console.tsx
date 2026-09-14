import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { socket } from '../App';

export const Console = ({ serverId }: { serverId: string }) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const [input, setInput] = useState('');

    useEffect(() => {
        if (!terminalRef.current) return;

        const term = new Terminal({
            theme: {
                background: '#050505',
                foreground: '#d1d5db',
                cursor: 'transparent',
                selectionBackground: 'rgba(255, 255, 255, 0.3)'
            },
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            fontSize: 13,
            disableStdin: true,
            convertEol: true
        });
        
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(terminalRef.current);
        fitAddon.fit();

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        const handleResize = () => {
            fitAddon.fit();
        };
        window.addEventListener('resize', handleResize);

        const handleLog = (data: {serverId: string, line: string}) => {
            if (data.serverId === serverId) {
                term.writeln(data.line);
            }
        };

        const handleHistory = (data: {serverId: string, history: string}) => {
            if (data.serverId === serverId) {
                term.clear();
                const lines = data.history.split('\n');
                lines.forEach(line => {
                    if (line) term.writeln(line);
                });
            }
        };

        socket.on('consoleLine', handleLog);
        socket.on('consoleHistory', handleHistory);
        socket.emit('subscribe:server', serverId);

        return () => {
            window.removeEventListener('resize', handleResize);
            socket.off('consoleLine', handleLog);
            socket.off('consoleHistory', handleHistory);
            socket.emit('unsubscribe:server', serverId);
            term.dispose();
        };
    }, [serverId]);

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
                    <button onClick={() => xtermRef.current?.clear()} className="glass-button px-3 py-1 text-xs">Clear</button>
                    <button onClick={() => xtermRef.current?.scrollToBottom()} className="glass-button px-3 py-1 text-xs">Scroll to Bottom</button>
                </div>
            </div>
            
            <div className="flex-1 bg-[#050505]/90 p-4 relative" style={{ overflow: 'hidden' }}>
                <div ref={terminalRef} className="absolute inset-4" />
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
