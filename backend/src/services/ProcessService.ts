import { wsService } from './WebSocketService';
import { exec } from 'child_process';
import { promisify } from 'util';
import { prisma } from '../index';
import { ServerStatus } from '@ramscraft/shared';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

export class ProcessService {
    
    private getSessionName(id: string) {
        return `ramscraft_${id.replace(/-/g, '_')}`;
    }
    
    public getLogFilePath(id: string) {
        const logDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        return path.join(logDir, `${this.getSessionName(id)}.log`);
    }

    public async hasSession(id: string): Promise<boolean> {
        try {
            await execAsync(`tmux has-session -t ${this.getSessionName(id)}`);
            return true;
        } catch {
            return false;
        }
    }

    public async getSessionPid(id: string): Promise<number | null> {
        try {
            const { stdout } = await execAsync(`tmux list-panes -t ${this.getSessionName(id)} -F "#{pane_pid}"`);
            const pid = parseInt(stdout.trim(), 10);
            return isNaN(pid) ? null : pid;
        } catch {
            return null;
        }
    }

    public async isJavaProcess(pid: number): Promise<boolean> {
        try {
            const { stdout } = await execAsync(`ps -p ${pid} -o command=`);
            // Check for java or our fake test bash script
            return stdout.includes('java') || stdout.includes('bash') || stdout.includes('node');
        } catch {
            return false;
        }
    }

    public async startServer(id: string, startCommand: string, directory: string): Promise<void> {
        const sessionName = this.getSessionName(id);
        const exists = await this.hasSession(id);
        if (exists) throw new Error('Session already exists');

        // Spawn detached tmux session
        const cmd = `tmux new-session -d -s ${sessionName} -c "${directory}" "${startCommand}"`;
        await execAsync(cmd);
        
        // Pipe pane output to log file for persistent console
        const logPath = this.getLogFilePath(id);
        await execAsync(`tmux pipe-pane -o -t ${sessionName} "cat >> ${logPath}"`);
        
        const pid = await this.getSessionPid(id);
        
        await prisma.server.update({
            where: { id },
            data: { 
                status: ServerStatus.STARTING,
                tmuxSessionName: sessionName,
                lastKnownPid: pid,
                lastStartedAt: new Date()
            }
        });
        wsService.emitServerStatus(id, ServerStatus.STARTING);
    }

    public async sendCommand(id: string, command: string): Promise<void> {
        if (!(await this.hasSession(id))) throw new Error('Server is not running');
        await execAsync(`tmux send-keys -t ${this.getSessionName(id)} "${command.replace(/"/g, '\\"')}" C-m`);
    }

    public async stopServer(id: string, timeoutMs: number = 60000): Promise<void> {
        await this.sendCommand(id, 'stop');
        await prisma.server.update({ where: { id }, data: { status: ServerStatus.STOPPING } });
        wsService.emitServerStatus(id, ServerStatus.STOPPING);

        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (!(await this.hasSession(id))) {
                await prisma.server.update({ where: { id }, data: { status: ServerStatus.OFFLINE, lastStoppedAt: new Date() } });
        wsService.emitServerStatus(id, ServerStatus.OFFLINE);
                wsService.emitServerStatus(id, ServerStatus.OFFLINE);
                return;
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        
        await this.forceKill(id);
    }

    public async forceKill(id: string): Promise<void> {
        try {
            await execAsync(`tmux kill-session -t ${this.getSessionName(id)}`);
        } catch (e) {
            // Ignore if already dead
        }
        await prisma.server.update({ where: { id }, data: { status: ServerStatus.OFFLINE, lastStoppedAt: new Date() } });
    }

    public async getConsoleHistory(id: string, lines: number = 1000): Promise<string> {
        const logPath = this.getLogFilePath(id);
        if (fs.existsSync(logPath)) {
            // Very basic tailing of the file for history
            try {
                const { stdout } = await execAsync(`tail -n ${lines} ${logPath}`);
                return stdout;
            } catch {
                return '';
            }
        }
        return '';
    }
}

export const processService = new ProcessService();
