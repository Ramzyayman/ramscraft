import fs from 'fs';
import { spawn } from 'child_process';

/**
 * Run tar (argv, no shell) while reporting progress in percent:
 *  - `input`: the archive is streamed into tar's stdin, so progress = archive bytes read.
 *  - `totalBytes`: GNU tar prints a checkpoint every 1000 records (10 KiB each), i.e. bytes archived.
 */
export function runTar(args: string[], opts: { input?: string; totalBytes?: number; onProgress: (percent: number) => void }):
    Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise(resolve => {
        const child = spawn('tar', opts.totalBytes ? ['--checkpoint=1000', ...args] : args);
        let stdout = '', stderr = '', pending = '';
        const timer = setTimeout(() => child.kill('SIGKILL'), 60 * 60_000);

        child.stdout.on('data', (b: Buffer) => { stdout += b.toString(); });
        child.stderr.on('data', (b: Buffer) => {
            const lines = (pending + b.toString()).split('\n');
            pending = lines.pop() ?? '';
            for (const line of lines) {
                const cp = line.match(/(?:Read|Write) checkpoint (\d+)/);
                if (cp && opts.totalBytes) opts.onProgress(Number(cp[1]) * 10240 / opts.totalBytes * 100);
                else if (line) stderr += line + '\n';
            }
        });

        if (opts.input) {
            const size = fs.statSync(opts.input).size || 1;
            let read = 0;
            const stream = fs.createReadStream(opts.input);
            stream.on('data', chunk => { read += chunk.length; opts.onProgress(read / size * 100); });
            stream.on('error', () => child.kill());
            child.stdin.on('error', () => { /* tar exited early; its exit code reports why */ });
            stream.pipe(child.stdin);
        } else {
            child.stdin.end();
        }

        child.on('error', e => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: e.message }); });
        child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr: stderr + pending }); });
    });
}
