import { execFile } from 'child_process';

export interface RunResult {
    stdout: string;
    stderr: string;
    code: number;
}

/**
 * Safe process execution: arguments are passed as an argv array to execFile, so
 * NO shell is involved and user-supplied values can never be interpreted as shell
 * syntax. Never build command strings for a shell anywhere in this codebase.
 */
export function run(
    file: string,
    args: string[],
    opts: { cwd?: string; timeoutMs?: number; input?: string } = {}
): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        const child = execFile(
            file,
            args,
            { cwd: opts.cwd, timeout: opts.timeoutMs ?? 0, maxBuffer: 32 * 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error && (error as any).killed) {
                    return reject(new Error(`${file} timed out`));
                }
                if (error && typeof (error as any).code === 'string') {
                    // Spawn-level failure (e.g. ENOENT), not just a non-zero exit.
                    return reject(error);
                }
                resolve({
                    stdout: stdout?.toString() ?? '',
                    stderr: stderr?.toString() ?? '',
                    code: error ? ((error as any).code ?? 1) : 0,
                });
            }
        );
        if (opts.input && child.stdin) {
            child.stdin.end(opts.input);
        }
    });
}

/** Run a command and return true only on a clean (exit 0) result. */
export async function runOk(file: string, args: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<boolean> {
    try {
        const r = await run(file, args, opts);
        return r.code === 0;
    } catch {
        return false;
    }
}
