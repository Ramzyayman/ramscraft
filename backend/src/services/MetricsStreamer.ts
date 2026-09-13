import { Server } from 'socket.io';
import { prisma } from '../index';
import { ServerStatus } from '@ramscraft/shared';
import { processService } from './ProcessService';
import pidusage from 'pidusage';
import os from 'os';
import net from 'net';
import { wsService } from './WebSocketService';

export class MetricsStreamer {
    private io: Server;
    private timer: NodeJS.Timer | null = null;

    constructor(io: Server) {
        this.io = io;
    }

    public start() {
        if (this.timer) return;
        this.timer = setInterval(() => {
            this.broadcastHostMetrics();
            this.broadcastServerMetrics();
            this.checkStartingServers();
        }, 2000);
    }

    public stop() {
        if (this.timer) clearInterval(this.timer as any);
        this.timer = null;
    }

    
    private async pingServer(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(2000);
            socket.on('connect', () => { socket.destroy(); resolve(true); });
            socket.on('timeout', () => { socket.destroy(); resolve(false); });
            socket.on('error', () => { socket.destroy(); resolve(false); });
            socket.connect(port, '127.0.0.1');
        });
    }

    private async checkStartingServers() {
        try {
            const startingServers = await prisma.server.findMany({
                where: { status: ServerStatus.STARTING }
            });
            for (const server of startingServers) {
                const isOnline = await this.pingServer(server.port);
                if (isOnline) {
                    await prisma.server.update({ where: { id: server.id }, data: { status: ServerStatus.ONLINE } });
                    wsService.emitServerStatus(server.id, ServerStatus.ONLINE);
                    console.log(`[MetricsStreamer] Server ${server.id} reached ONLINE state.`);
                }
            }
        } catch (e) {}
    }

    private async broadcastHostMetrics() {
        const room = this.io.sockets.adapter.rooms.get('host');
        if (!room || room.size === 0) return; // Nobody listening

        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        
        const hostMetrics = {
            cpuUsage: os.loadavg()[0], // 1 minute load avg
            memUsedMb: Math.round(usedMem / 1024 / 1024),
            memTotalMb: Math.round(totalMem / 1024 / 1024),
            uptimeSec: os.uptime()
        };

        this.io.to('host').emit('hostMetrics', hostMetrics);
    }

    private async broadcastServerMetrics() {
        // Find all servers that currently have clients listening
        const rooms = this.io.sockets.adapter.rooms;
        
        // Optimize: Only fetch from DB if there are any active server rooms
        let hasActiveServerRooms = false;
        for (const [roomName] of rooms.entries()) {
            if (roomName.startsWith('server_')) {
                hasActiveServerRooms = true;
                break;
            }
        }
        if (!hasActiveServerRooms) return;

        try {
            const onlineServers = await prisma.server.findMany({
                where: { status: ServerStatus.ONLINE }
            });

            for (const server of onlineServers) {
                const roomName = `server_${server.id}`;
                const room = rooms.get(roomName);
                if (!room || room.size === 0) continue; // Skip if nobody is viewing this server

                if (server.lastKnownPid) {
                    try {
                        const stats = await pidusage(server.lastKnownPid);
                        this.io.to(roomName).emit('serverMetrics', {
                            serverId: server.id,
                            cpuPercent: stats.cpu,
                            memUsedMb: Math.round(stats.memory / 1024 / 1024)
                        });
                    } catch (e) {
                        // PID might have died but hasn't reconciled yet
                    }
                }
            }
        } catch (e) {
            console.error('[MetricsStreamer] Error broadcasting server metrics', e);
        }
    }
}
