import fs from 'fs';
import path from 'path';
import { InstallResult } from '../providers/ISoftwareProvider';

/** Server-owned entries an install never overwrites when they already exist (world folders are added per server). */
const KEEP_EXISTING = ['server.properties', 'eula.txt', 'ops.json', 'whitelist.json', 'banned-players.json', 'banned-ips.json', 'usercache.json', 'logs', '.ramscraft'];

function levelName(serverDir: string): string {
    try {
        const line = fs.readFileSync(path.join(serverDir, 'server.properties'), 'utf8').split('\n').find(l => l.startsWith('level-name='));
        return line?.slice('level-name='.length).trim() || 'world';
    } catch {
        return 'world';
    }
}

/**
 * Move the staged software into the server directory. Directories merge file by file
 * (except `replace` ones, swapped wholesale); anything overwritten is kept in
 * .ramscraft/replaced (latest change only). Server-owned files and worlds that already
 * exist are never touched. Any failure puts everything back.
 */
export function installFiles(stagingDir: string, serverDir: string, result: Pick<InstallResult, 'files' | 'replace'>) {
    const level = levelName(serverDir);
    const keep = new Set([...KEEP_EXISTING, level, `${level}_nether`, `${level}_the_end`]);
    const replace = new Set(result.replace ?? ['libraries']);
    const backupRoot = path.join(serverDir, '.ramscraft', 'replaced');
    fs.rmSync(backupRoot, { recursive: true, force: true });
    const undo: (() => void)[] = [];

    const place = (rel: string, wholesale: boolean) => {
        const src = path.join(stagingDir, rel);
        const dst = path.join(serverDir, rel);
        const dstExists = fs.existsSync(dst);
        if (!wholesale && dstExists && fs.statSync(src).isDirectory() && fs.statSync(dst).isDirectory()) {
            for (const child of fs.readdirSync(src)) place(path.join(rel, child), false);
            return;
        }
        if (dstExists) {
            const backup = path.join(backupRoot, rel);
            fs.mkdirSync(path.dirname(backup), { recursive: true });
            fs.renameSync(dst, backup);
            undo.push(() => fs.renameSync(backup, dst));
        }
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.renameSync(src, dst);
        undo.push(() => fs.renameSync(dst, src));
    };

    try {
        for (const name of result.files) {
            if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) throw new Error(`Invalid installed file name: ${name}`);
            if (!fs.existsSync(path.join(stagingDir, name))) throw new Error(`Installer did not produce ${name}`);
            if (keep.has(name) && fs.existsSync(path.join(serverDir, name))) continue; // the server's own copy wins
            place(name, replace.has(name));
        }
    } catch (e) {
        for (const step of undo.reverse()) {
            try { step(); } catch { /* best effort */ }
        }
        throw e;
    }
}
