import { wsService } from './WebSocketService';
import { prisma } from '../index';
import { ServerStatus } from '@ramscraft/shared';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { run, runOk } from '../utils/exec';
import { stripAnsi } from '../utils/ansi';

/**
 * Owns all interaction with tmux/OS processes. Every command is executed via argv
 * arrays (no shell), so user-controlled values (console commands, player names)
 * can never be interpreted as shell syntax.
 */
export class ProcessService {

    private getSessionName(id: string) {
        return `ramscraft_${id.replace(/-/g, '_')}`;
    }

    public getLogFilePath(id: string) {
        const logDir = config.logsDir;
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        return path.join(logDir, `${this.getSessionName(id)}.log`);
    }

    public async hasSession(id: string): Promise<boolean> {
        return runOk('tmux', ['has-session', '-t', this.getSessionName(id)]);
    }

    public async getSessionPid(id: string): Promise<number | null> {
        try {
            const { stdout, code } = await run('tmux', ['list-panes', '-t', this.getSessionName(id), '-F', '#{pane_pid}']);
            if (code !== 0) return null;
            const pid = parseInt(stdout.trim().split('\n')[0], 10);
            return isNaN(pid) ? null : pid;
        } catch {
            return null;
        }
    }

    /** The full command line of a pid, or null if it does not exist. */
    private async getProcessCmdline(pid: number): Promise<string | null> {
        try {
            const cmdlinePath = `/proc/${pid}/cmdline`;
            if (fs.existsSync(cmdlinePath)) {
                return fs.readFileSync(cmdlinePath, 'utf8').replace(/\0/g, ' ').trim();
            }
            const { stdout, code } = await run('ps', ['-p', String(pid), '-o', 'args=']);
            return code === 0 ? stdout.trim() : null;
        } catch {
            return null;
        }
    }

    /** The working directory of a pid via /proc, or null. */
    private getProcessCwd(pid: number): string | null {
        try {
            return fs.realpathSync(`/proc/${pid}/cwd`);
        } catch {
            return null;
        }
    }

    /**
     * Strong identity check: is `pid` actually THIS server's JVM? We require a live
     * java process whose working directory is the server's own directory. This
     * defeats (a) PID reuse after a crash/reboot and (b) another service answering
     * on the same TCP port. A bare pid or a port ping is never trusted alone.
     */
    public async isServerProcess(pid: number | null, serverDir: string): Promise<boolean> {
        if (!pid || pid <= 1) return false;
        const cmd = await this.getProcessCmdline(pid);
        if (!cmd || !/\bjava\b/.test(cmd)) return false;
        const cwd = this.getProcessCwd(pid);
        if (!cwd) return false;
        try {
            return fs.realpathSync(cwd) === fs.realpathSync(serverDir);
        } catch {
            return false;
        }
    }

    public async startServer(id: string, javaPath: string, args: string[], directory: string): Promise<void> {
        const sessionName = this.getSessionName(id);
        if (await this.hasSession(id)) throw new Error('Server session already exists');

        // Detached tmux session; command is passed as argv (no shell interpolation).
        const res = await run('tmux', ['new-session', '-d', '-s', sessionName, '-c', directory, javaPath, ...args]);
        if (res.code !== 0) {
            throw new Error(`Failed to start tmux session: ${res.stderr || res.stdout}`.trim());
        }

        // Persist console output. The log path is app-controlled (no user input).
        const logPath = this.getLogFilePath(id);
        await run('tmux', ['pipe-pane', '-o', '-t', sessionName, `cat >> '${logPath.replace(/'/g, "'\\''")}'`]);

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
        // Console commands are single-line; strip newlines so a value cannot inject
        // extra console lines. No shell is involved (argv), so shell metachars are inert.
        const line = command.replace(/[\r\n]+/g, ' ');
        const sessionName = this.getSessionName(id);
        // -l sends the text literally (no tmux key-name interpretation), then Enter.
        await run('tmux', ['send-keys', '-t', sessionName, '-l', '--', line]);
        await run('tmux', ['send-keys', '-t', sessionName, 'Enter']);
    }

    /**
     * Send a console command and return the console messages the server printed
     * after it (text after the "[time LEVEL]:" prefix), read back from the
     * pipe-pane log. Waits `waitMs`, or with `until` up to 10s for a matching line.
     * ponytail: shares the console with everything else, so unrelated lines logged
     * in the same window are included; a plugin/RCON reply channel is the upgrade.
     */
    public async sendCommandCapture(id: string, command: string, opts: { waitMs?: number; until?: RegExp } = {}): Promise<string[]> {
        const logPath = this.getLogFilePath(id);
        const start = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
        await this.sendCommand(id, command);

        const deadline = Date.now() + (opts.until ? 10_000 : opts.waitMs ?? 800);
        let messages: string[] = [];
        do {
            await new Promise(r => setTimeout(r, 200));
            messages = this.readConsoleMessages(logPath, start);
        } while (Date.now() < deadline && !(opts.until && messages.some(m => opts.until!.test(m))));
        return messages;
    }

    private readConsoleMessages(logPath: string, from: number): string[] {
        let text = '';
        try {
            const fd = fs.openSync(logPath, 'r');
            try {
                const size = fs.fstatSync(fd).size;
                const buf = Buffer.alloc(Math.max(0, size - from));
                fs.readSync(fd, buf, 0, buf.length, from);
                text = buf.toString('utf8');
            } finally {
                fs.closeSync(fd);
            }
        } catch {
            return [];
        }
        // Paper: "[18:58:22 INFO]: msg"   Vanilla: "[18:58:22] [Server thread/INFO]: msg"
        const prefix = /\[\d{2}:\d{2}:\d{2}[^\]]*\](?: \[[^\]]*\])?: ?(.*)$/;
        return stripAnsi(text).split('\n')
            .map(line => line.match(prefix)?.[1]?.trim())
            .filter((m): m is string => !!m);
    }

    public async stopServer(id: string, timeoutMs: number = 60000): Promise<void> {
        await prisma.server.update({ where: { id }, data: { status: ServerStatus.STOPPING } });
        wsService.emitServerStatus(id, ServerStatus.STOPPING);

        if (await this.hasSession(id)) {
            try { await this.sendCommand(id, 'stop'); } catch { /* fall through to kill */ }

            const start = Date.now();
            while (await this.hasSession(id)) {
                if (Date.now() - start > timeoutMs) {
                    await this.killSession(id);
                    break;
                }
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        await prisma.server.update({
            where: { id },
            data: { status: ServerStatus.OFFLINE, tmuxSessionName: null, lastKnownPid: null, lastStoppedAt: new Date() }
        });
        wsService.emitServerStatus(id, ServerStatus.OFFLINE);
    }

    /** Kill the tmux session (and thus the JVM child) without touching the DB status. */
    public async killSession(id: string): Promise<void> {
        await runOk('tmux', ['kill-session', '-t', this.getSessionName(id)]);
    }

    public async forceKill(id: string, finalStatus: ServerStatus = ServerStatus.CRASHED): Promise<void> {
        await this.killSession(id);
        await prisma.server.update({
            where: { id },
            data: { status: finalStatus, tmuxSessionName: null, lastKnownPid: null }
        });
        wsService.emitServerStatus(id, finalStatus);
    }

    public async getConsoleHistory(id: string, lines: number = 1000): Promise<string> {
        const logPath = this.getLogFilePath(id);
        if (!fs.existsSync(logPath)) return '';
        try {
            const content = fs.readFileSync(logPath, 'utf8');
            const tail = content.split('\n').slice(-lines).join('\n');
            return stripAnsi(tail);
        } catch {
            return '';
        }
    }
}

export const processService = new ProcessService();
