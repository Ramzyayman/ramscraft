import { ChildProcess, spawn } from 'child_process';
import { Server } from 'socket.io';
import { processService } from './ProcessService';
import fs from 'fs';

export class ConsoleStreamer {
    private streamers: Map<string, ChildProcess> = new Map();

    public startStreaming(serverId: string, io: Server) {
        if (this.streamers.has(serverId)) return;

        const logPath = processService.getLogFilePath(serverId);
        if (!fs.existsSync(logPath)) {
            // Create empty log file if it doesn't exist so tail doesn't fail immediately
            fs.writeFileSync(logPath, '');
        }

        console.log(`[ConsoleStreamer] Starting tail for ${serverId}`);
        
        // tail -F follows by name, allowing log rotation or file recreation
        const tailProcess = spawn('tail', ['-F', '-n', '0', logPath]);

        tailProcess.stdout.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n');
            for (let line of lines) {
                if (line) {
                    io.to(`server_${serverId}`).emit('consoleLine', { serverId, line });
                }
            }
        });

        tailProcess.stderr.on('data', (data) => {
            console.error(`[ConsoleStreamer ${serverId}] Error: `, data.toString());
        });

        tailProcess.on('close', () => {
            console.log(`[ConsoleStreamer] Tail closed for ${serverId}`);
            this.streamers.delete(serverId);
        });

        this.streamers.set(serverId, tailProcess);
    }

    public checkAndStopStreaming(serverId: string, io: Server) {
        const room = io.sockets.adapter.rooms.get(`server_${serverId}`);
        if (!room || room.size === 0) {
            this.stopStreaming(serverId);
        }
    }

    public stopStreaming(serverId: string) {
        const tailProcess = this.streamers.get(serverId);
        if (tailProcess) {
            console.log(`[ConsoleStreamer] Stopping tail for ${serverId}`);
            tailProcess.kill();
            this.streamers.delete(serverId);
        }
    }
}

export const consoleStreamer = new ConsoleStreamer();
