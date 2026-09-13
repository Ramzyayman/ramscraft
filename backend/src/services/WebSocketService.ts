import { Server, Socket } from 'socket.io';
import http from 'http';
import { processService } from './ProcessService';
import { consoleStreamer } from './ConsoleStreamer';

import pidusage from 'pidusage';
import { prisma } from '../index';

export class WebSocketService {
    public io!: Server;
    private statsInterval: NodeJS.Timeout | null = null;

    public init(server: http.Server) {
        this.io = new Server(server, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            }
        });

        this.io.on('connection', (socket: Socket) => {
            console.log(`[WS] Client connected: ${socket.id}`);

            socket.on('subscribe:host', () => {
                socket.join('host');
            });

            socket.on('subscribe:server', async (serverId: string) => {
                socket.join(`server_${serverId}`);
                console.log(`[WS] Client ${socket.id} subscribed to server_${serverId}`);
                
                try {
                    const history = await processService.getConsoleHistory(serverId, 1000);
                    socket.emit('consoleHistory', { serverId, history });
                } catch (e) {
                    console.error(`Failed to send history for ${serverId}`, e);
                }

                consoleStreamer.startStreaming(serverId, this.io);
            });

            socket.on('unsubscribe:server', (serverId: string) => {
                socket.leave(`server_${serverId}`);
                console.log(`[WS] Client ${socket.id} unsubscribed from server_${serverId}`);
                consoleStreamer.checkAndStopStreaming(serverId, this.io);
            });

            socket.on('sendCommand', async (data: { serverId: string, command: string }) => {
                try {
                    await processService.sendCommand(data.serverId, data.command);
                } catch (e) {
                    socket.emit('consoleLine', { serverId: data.serverId, line: `\x1b[31m[RamsCraft] Error sending command: ${(e as Error).message}\x1b[0m` });
                }
            });

            socket.on('disconnect', () => {
                console.log(`[WS] Client disconnected: ${socket.id}`);
            });
        });

        this.io.of('/').adapter.on('leave-room', (room: string) => {
            if (room.startsWith('server_')) {
                const serverId = room.replace('server_', '');
                consoleStreamer.checkAndStopStreaming(serverId, this.io);
            }
        });

        this.startStatsBroadcaster();
    }

    private startStatsBroadcaster() {
        if (this.statsInterval) clearInterval(this.statsInterval);
        
        this.statsInterval = setInterval(async () => {
            if (!this.io) return;
            const rooms = this.io.of('/').adapter.rooms;
            const serverIdsToPoll = new Set<string>();

            for (const [roomName] of rooms.entries()) {
                if (roomName.startsWith('server_')) {
                    serverIdsToPoll.add(roomName.replace('server_', ''));
                }
            }

            if (serverIdsToPoll.size === 0) return;

            try {
                const servers = await prisma.server.findMany({
                    where: { id: { in: Array.from(serverIdsToPoll) }, status: { in: ['RUNNING', 'STARTING'] } }
                });

                for (const server of servers) {
                    if (!server.lastKnownPid) continue;

                    try {
                        const stats = await pidusage(server.lastKnownPid);
                        const uptimeMs = server.lastStartedAt ? Date.now() - new Date(server.lastStartedAt).getTime() : 0;
                        
                        this.io.to(`server_${server.id}`).emit('serverStats', {
                            serverId: server.id,
                            cpu: stats.cpu,
                            memory: stats.memory,
                            uptimeMs
                        });
                    } catch (e) {
                        // pidusage might fail if process died
                    }
                }
            } catch (e) {
                console.error("[WS] Error in stats broadcaster:", e);
            }
        }, 3000);
    }

    public emitServerStatus(serverId: string, status: string) {
        if (this.io) {
            this.io.emit('serverStatus', { serverId, status });
        }
    }
}

export const wsService = new WebSocketService();
