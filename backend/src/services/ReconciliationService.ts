import { prisma } from '../index';
import { ServerStatus } from '@ramscraft/shared';
import { processService } from './ProcessService';
import { pingMinecraft } from '../utils/mcping';
import { serverRoot } from '../utils/paths';
import fs from 'fs';
import path from 'path';

/**
 * On boot, converge the DB with reality. Status is derived from a VERIFIED process
 * (tmux session + a JVM whose cwd is this server's directory) — never from a bare
 * stored PID (PID reuse) or a TCP port that another service might answer.
 */
export class ReconciliationService {

    public async reconcileOnStartup(): Promise<void> {
        console.log('[Reconciliation] Starting full state reconciliation...');
        // NOTE: orphaned console tails are prevented at the source by the shutdown
        // handler in index.ts (consoleStreamer.stopAll()). We deliberately do NOT
        // pattern-kill processes here — a system-wide `pkill -f` can match and kill
        // unrelated processes belonging to the user.

        const servers = await prisma.server.findMany();

        for (const server of servers) {
            let dir: string;
            try {
                dir = serverRoot(server.directoryName);
            } catch {
                continue;
            }

            let nextStatus: ServerStatus = ServerStatus.OFFLINE;
            let pid: number | null = null;

            if (await processService.hasSession(server.id)) {
                pid = await processService.getSessionPid(server.id);
                if (await processService.isServerProcess(pid, dir)) {
                    // Verified our JVM is alive. ONLINE only if it also answers the
                    // Minecraft protocol; otherwise it is still starting.
                    const online = await pingMinecraft('127.0.0.1', server.port);
                    nextStatus = online ? ServerStatus.ONLINE : ServerStatus.STARTING;
                } else {
                    // Session exists but the process is not ours (stale/hijacked/reused).
                    console.warn(`[Reconciliation] Stale session for ${server.name}; cleaning up.`);
                    await processService.killSession(server.id);
                    nextStatus = ServerStatus.OFFLINE;
                    pid = null;
                }
            }
            // No session => OFFLINE. We deliberately do NOT signal any stored PID:
            // after a crash/reboot that PID may belong to an unrelated process.

            // EULA file sync (unchanged behaviour).
            let eulaAccepted = false;
            const eulaPath = path.join(dir, 'eula.txt');
            if (fs.existsSync(eulaPath)) {
                eulaAccepted = fs.readFileSync(eulaPath, 'utf8').includes('eula=true');
            }

            await prisma.server.update({
                where: { id: server.id },
                data: {
                    status: nextStatus,
                    eulaAccepted,
                    tmuxSessionName: nextStatus !== ServerStatus.OFFLINE ? `ramscraft_${server.id.replace(/-/g, '_')}` : null,
                    lastKnownPid: nextStatus !== ServerStatus.OFFLINE ? pid : null
                }
            });
            console.log(`[Reconciliation] ${server.name} reconciled to ${nextStatus}`);
        }
    }
}
