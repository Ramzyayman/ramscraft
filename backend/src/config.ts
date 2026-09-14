import path from 'path';
import dotenv from 'dotenv';

// Load .env from the backend working directory if present.
dotenv.config();

function bool(v: string | undefined, def = false): boolean {
    if (v === undefined) return def;
    return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

/**
 * Central runtime configuration. All network/security-sensitive knobs live here
 * so the exposure model is explicit and auditable in one place.
 */
export const config = {
    port: Number(process.env.PORT || 3001),

    // Bind to loopback by default. Network exposure must be opted into AND
    // requires an API token (enforced in index.ts / auth middleware).
    host: process.env.RAMSCRAFT_HOST || '127.0.0.1',

    // Shared secret protecting the management API + WebSocket. When unset, only
    // loopback callers are allowed (the intended reverse-proxy / RamsesHub model).
    apiToken: process.env.RAMSCRAFT_API_TOKEN || '',

    // Comma-separated list of allowed browser origins for CORS. Empty => same-origin
    // only (the SPA is served by this backend, so no cross-origin access is needed).
    allowedOrigins: (process.env.RAMSCRAFT_ALLOWED_ORIGINS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),

    // Root directory that holds per-server directories. Everything the file/backup
    // APIs touch must resolve inside <serversRoot>/<directoryName>.
    serversRoot: path.resolve(process.env.RAMSCRAFT_SERVERS_ROOT || path.join(process.cwd(), '..', 'servers')),

    // Directory holding persistent console logs.
    logsDir: path.resolve(process.env.RAMSCRAFT_LOGS_DIR || path.join(process.cwd(), 'logs')),

    // Shared download/build cache for software installs (e.g. Spigot BuildTools work tree).
    cacheDir: path.resolve(process.env.RAMSCRAFT_CACHE_DIR || path.join(process.cwd(), '..', 'cache')),

    // Skip Minecraft-protocol confirmation of ONLINE (useful only for tests).
    trustProcessOnly: bool(process.env.RAMSCRAFT_TRUST_PROCESS_ONLY, false),
};

export function isLoopbackAddress(addr: string | undefined): boolean {
    if (!addr) return false;
    return (
        addr === '127.0.0.1' ||
        addr === '::1' ||
        addr === '::ffff:127.0.0.1' ||
        addr.startsWith('127.')
    );
}
