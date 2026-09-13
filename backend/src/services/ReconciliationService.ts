import { wsService } from './WebSocketService';
import { prisma } from '../index';
import { ServerStatus } from '@ramscraft/shared';
import { processService } from './ProcessService';
import net from 'net';
import fs from 'fs';
import path from 'path';

export class ReconciliationService {
    
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

    public async reconcileOnStartup(): Promise<void> {
        console.log('[Reconciliation] Starting full state reconciliation...');
        
        const servers = await prisma.server.findMany();
        
        for (const server of servers) {
            let nextStatus = ServerStatus.OFFLINE;

            // 1. Check if tmux session exists
            const hasSession = await processService.hasSession(server.id);
            
            if (hasSession) {
                // 2. Verify it is a valid Java process
                const pid = await processService.getSessionPid(server.id);
                if (pid && await processService.isJavaProcess(pid)) {
                    // 3. Process is alive. Check if Minecraft is accepting connections (ONLINE vs STARTING)
                    const isOnline = await this.pingServer(server.port);
                    nextStatus = isOnline ? ServerStatus.ONLINE : ServerStatus.STARTING;
                } else {
                    // Tmux exists but process inside is dead/hijacked. Kill the stale session.
                    console.warn(`[Reconciliation] Stale/Dead tmux session found for ${server.name}. Cleaning up.`);
                    await processService.forceKill(server.id);
                }
            } else if (server.lastKnownPid) {
                // Check if the process survived outside of tmux (Orphan)
                const isJava = await processService.isJavaProcess(server.lastKnownPid);
                if (isJava) {
                    console.warn(`[Reconciliation] Orphaned Java process ${server.lastKnownPid} found for ${server.name}. Force killing as it lost its console.`);
                    try {
                        process.kill(server.lastKnownPid, 'SIGKILL');
                    } catch (e) {}
                }
            }

            // 4. Check EULA File sync
            const serverRoot = path.join(process.cwd(), '..', 'servers', server.directoryName);
            const eulaPath = path.join(serverRoot, 'eula.txt');
            let eulaAccepted = false;
            
            if (fs.existsSync(eulaPath)) {
                const eulaContent = fs.readFileSync(eulaPath, 'utf8');
                eulaAccepted = eulaContent.includes('eula=true');
            }

            if (nextStatus === ServerStatus.OFFLINE && !eulaAccepted) {
                // If it's offline and eula is not accepted, prompt it
                // Wait, if it has never been started, maybe it's just OFFLINE.
                // We'll trust the user command to start it to set EULA_PENDING.
            }

            // Update Database
            await prisma.server.update({
                where: { id: server.id },
                data: {
                    status: nextStatus,
                    eulaAccepted,
                    tmuxSessionName: nextStatus !== ServerStatus.OFFLINE ? `ramscraft_${server.id.replace(/-/g, '_')}` : null
                }
            });
            
            console.log(`[Reconciliation] ${server.name} reconciled to ${nextStatus}`);
        }
    }
}
