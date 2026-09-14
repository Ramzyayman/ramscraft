import fs from 'fs';
import path from 'path';
import { isInside } from '../utils/paths';

/**
 * How the installed software is started, relative to the server directory:
 * a runnable jar, or a JVM @argument file (modern Forge/NeoForge have no server jar).
 */
export type LaunchConfig = { jar: string } | { argsFile: string };

const LAUNCH_FILE = path.join('.ramscraft', 'launch.json');

/** Servers installed before launch configs existed run server.jar, as before. */
export function readLaunchConfig(serverDir: string): LaunchConfig {
    try {
        const c = JSON.parse(fs.readFileSync(path.join(serverDir, LAUNCH_FILE), 'utf8'));
        if (typeof c.jar === 'string') return { jar: c.jar };
        if (typeof c.argsFile === 'string') return { argsFile: c.argsFile };
    } catch { /* no config yet */ }
    return { jar: 'server.jar' };
}

export function writeLaunchConfig(serverDir: string, launch: LaunchConfig) {
    const file = path.join(serverDir, LAUNCH_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(launch, null, 2));
}

/** The launch target exists and stays inside the server directory. */
export function launchFilePresent(serverDir: string, launch: LaunchConfig): boolean {
    const target = path.resolve(serverDir, 'jar' in launch ? launch.jar : launch.argsFile);
    return isInside(serverDir, target) && fs.existsSync(target);
}

export const memoryArgs = (min: number, max: number) => [`-Xms${min}M`, `-Xmx${max}M`];

/** JVM arguments that start the software, after memory/GC flags. */
export function launchArgs(launch: LaunchConfig): string[] {
    return 'jar' in launch ? ['-jar', launch.jar, 'nogui'] : [`@${launch.argsFile}`, 'nogui'];
}
