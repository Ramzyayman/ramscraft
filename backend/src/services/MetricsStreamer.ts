import { Server } from 'socket.io';
import { prisma } from '../index';
import { ServerStatus } from '@ramscraft/shared';
import { processService } from './ProcessService';
import { pingMinecraft, getMinecraftStats } from '../utils/mcping';
import { serverRoot } from '../utils/paths';
import pidusage from 'pidusage';
import os from 'os';
import { wsService } from './WebSocketService';

/**
 * Single authoritative loop for status reconciliation AND live metrics. Replaces
 * the previous two overlapping intervals (one of which filtered on the
 * non-existent status "RUNNING", so live metrics never reached the UI).
 *
 * Every tick, for each STARTING/ONLINE server it:
 *   - confirms the tmux session + our JVM (cwd match) are alive -> else CRASHED;
 *   - promotes STARTING -> ONLINE once the MC protocol answers;
 *   - emits `serverStats` (cpu/mem/uptime) to viewers of ONLINE/STARTING servers.
 * It also emits host metrics to the `host` room.
 */
export class MetricsStreamer {
    private io: Server;
    private timer: NodeJS.Timeout | null = null;
    private ticking = false;

    constructor(io: Server) {
        this.io = io;
    }

    public start() {
        if (this.timer) return;
        this.timer = setInterval(() => { void this.tick(); }, 2000);
    }

    public stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    private async tick() {
        if (this.ticking) return; // prevent overlap if a tick runs long
        this.ticking = true;
        try {
            this.broadcastHostMetrics();
            await this.reconcileActive();
        } catch (e) {
            console.error('[Status] tick error', e);
        } finally {
            this.ticking = false;
        }
    }

    private roomSize(name: string): number {
        return this.io.sockets.adapter.rooms.get(name)?.size ?? 0;
    }

    private async reconcileActive() {
        const active = await prisma.server.findMany({
            where: { status: { in: [ServerStatus.STARTING, ServerStatus.ONLINE] } }
        });

        for (const server of active) {
            let dir: string;
            try { dir = serverRoot(server.directoryName); } catch { continue; }

            const hasSession = await processService.hasSession(server.id);
            const pid = hasSession ? await processService.getSessionPid(server.id) : null;
            const alive = hasSession && await processService.isServerProcess(pid, dir);

            if (!alive) {
                // Session gone or process is not ours: the server has crashed.
                await prisma.server.update({
                    where: { id: server.id },
                    data: { status: ServerStatus.CRASHED, tmuxSessionName: null, lastKnownPid: null }
                });
                wsService.emitServerStatus(server.id, ServerStatus.CRASHED);
                if (hasSession) await processService.killSession(server.id);
                console.log(`[Status] ${server.name} crashed (process gone).`);
                continue;
            }

            // Keep the verified pane pid current (defeats stale pid metrics after restart).
            if (pid && pid !== server.lastKnownPid) {
                await prisma.server.update({ where: { id: server.id }, data: { lastKnownPid: pid } });
            }

            if (server.status === ServerStatus.STARTING) {
                if (await pingMinecraft('127.0.0.1', server.port)) {
                    await prisma.server.update({ where: { id: server.id }, data: { status: ServerStatus.ONLINE } });
                    wsService.emitServerStatus(server.id, ServerStatus.ONLINE);
                    console.log(`[Status] ${server.name} is ONLINE.`);
                }
            }

            // Emit live stats to anyone viewing this server.
            const effectivePid = pid ?? server.lastKnownPid;
            if (effectivePid && this.roomSize(`server_${server.id}`) > 0) {
                try {
                    const stats = await pidusage(effectivePid);
                    const uptimeMs = server.lastStartedAt ? Date.now() - new Date(server.lastStartedAt).getTime() : 0;
                    
                    let players = null;
                    if (server.status === ServerStatus.ONLINE) {
                        players = await getMinecraftStats('127.0.0.1', server.port);
                    }

                    this.io.to(`server_${server.id}`).emit('serverStats', {
                        serverId: server.id,
                        cpu: stats.cpu,
                        memory: stats.memory,
                        uptimeMs,
                        players
                    });
                } catch { /* process may have just exited; next tick reconciles */ }
            }
        }
    }

    private broadcastHostMetrics() {
        if (this.roomSize('host') === 0) return;
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        this.io.to('host').emit('hostMetrics', {
            cpuUsage: os.loadavg()[0],
            memUsedMb: Math.round((totalMem - freeMem) / 1024 / 1024),
            memTotalMb: Math.round(totalMem / 1024 / 1024),
            uptimeSec: os.uptime()
        });
    }
}
