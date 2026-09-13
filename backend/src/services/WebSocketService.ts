import { Server, Socket } from 'socket.io';
import http from 'http';
import { processService } from './ProcessService';
import { consoleStreamer } from './ConsoleStreamer';
import { config, isLoopbackAddress } from '../config';

export class WebSocketService {
    public io!: Server;

    public init(server: http.Server) {
        this.io = new Server(server, {
            cors: {
                // Same-origin by default; only explicitly allowed origins may connect.
                origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : false,
                methods: ['GET', 'POST']
            }
        });

        // Authenticate every socket at handshake. Same policy as the REST guard:
        // a valid token if one is configured, otherwise loopback-only.
        this.io.use((socket, next) => {
            const addr = socket.handshake.address;
            const auth = (socket.handshake.auth || {}) as any;
            const token = auth.token
                || (socket.handshake.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '')
                || (socket.handshake.query.token as string);

            if (config.apiToken) {
                if (token && timingSafeEqual(token, config.apiToken)) return next();
                return next(new Error('unauthorized'));
            }
            if (isLoopbackAddress(addr)) return next();
            return next(new Error('unauthorized: token required for remote access'));
        });

        this.io.on('connection', (socket: Socket) => {
            socket.on('subscribe:host', () => socket.join('host'));

            socket.on('subscribe:server', async (serverId: string) => {
                if (typeof serverId !== 'string') return;
                socket.join(`server_${serverId}`);
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
                consoleStreamer.checkAndStopStreaming(serverId, this.io);
            });

            socket.on('sendCommand', async (data: { serverId: string, command: string }) => {
                try {
                    if (!data || typeof data.serverId !== 'string' || typeof data.command !== 'string') return;
                    await processService.sendCommand(data.serverId, data.command);
                } catch (e) {
                    socket.emit('consoleLine', { serverId: data?.serverId, line: `[RamsCraft] Error sending command: ${(e as Error).message}` });
                }
            });
        });

        this.io.of('/').adapter.on('leave-room', (room: string) => {
            if (room.startsWith('server_')) {
                consoleStreamer.checkAndStopStreaming(room.replace('server_', ''), this.io);
            }
        });
        // Live metrics + status reconciliation are owned by MetricsStreamer (single loop).
    }

    public emitServerStatus(serverId: string, status: string) {
        if (this.io) {
            this.io.emit('serverStatus', { serverId, status });
        }
    }
}

/** Constant-time string comparison to avoid token timing leaks. */
export function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

export const wsService = new WebSocketService();
