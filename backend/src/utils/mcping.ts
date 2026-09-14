import * as util from 'minecraft-server-util';

/**
 * True if a Minecraft server answers the status (SLP) handshake on host:port.
 * Used ONLY to distinguish STARTING vs ONLINE for a server whose process identity
 * has already been verified — never as standalone proof that a server is up.
 */
export async function pingMinecraft(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
    try {
        await util.status(host, port, { timeout: timeoutMs, enableSRV: false });
        return true;
    } catch {
        return false;
    }
}

export async function getMinecraftStats(host: string, port: number, timeoutMs = 2000): Promise<{online: number, max: number} | null> {
    try {
        const res = await util.status(host, port, { timeout: timeoutMs, enableSRV: false });
        return { online: res.players.online, max: res.players.max };
    } catch (e) {
        console.error(`getMinecraftStats failed for ${host}:${port}`, e);
        return null;
    }
}
