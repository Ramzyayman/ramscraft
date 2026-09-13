import { Server, Socket } from 'socket.io';
import http from 'http';
import { processService } from './ProcessService';
import { consoleStreamer } from './ConsoleStreamer';

export class WebSocketService {
    public io!: Server;

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
                
                // Send history immediately upon subscription
                try {
                    const history = await processService.getConsoleHistory(serverId, 1000);
                    socket.emit('consoleHistory', { serverId, history });
                } catch (e) {
                    console.error(`Failed to send history for ${serverId}`, e);
                }

                // Ensure the console streamer is running for this server
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
                // Socket.io automatically leaves rooms on disconnect.
                // We could hook into adapter room leaving to stop streamers.
            });
        });

        // Listen for room emptiness to stop tailing
        this.io.of('/').adapter.on('leave-room', (room: string) => {
            if (room.startsWith('server_')) {
                const serverId = room.replace('server_', '');
                consoleStreamer.checkAndStopStreaming(serverId, this.io);
            }
        });
    }

    public emitServerStatus(serverId: string, status: string) {
        if (this.io) {
            this.io.to(`server_${serverId}`).emit('serverStatus', { serverId, status });
        }
    }
}

export const wsService = new WebSocketService();
