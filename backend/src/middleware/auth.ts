import { Request, Response, NextFunction } from 'express';
import { config, isLoopbackAddress } from '../config';
import { timingSafeEqual } from '../services/WebSocketService';

/**
 * Authentication boundary for the management API.
 *
 * Model (safest standalone, clean for future RamsesHub integration):
 *  - If RAMSCRAFT_API_TOKEN is set, every /api request must present it
 *    (Authorization: Bearer <token>, X-RamsCraft-Token, or ?token=).
 *  - If no token is configured, only loopback callers are allowed. This is the
 *    reverse-proxy model: nginx/RamsesHub terminates auth and proxies to
 *    127.0.0.1:3001, so RamsCraft trusts loopback and RamsesHub gates the user.
 *  - Remote calls without a token are rejected. index.ts additionally refuses to
 *    bind to a non-loopback interface unless a token is set (fail closed).
 */
export function authGuard(req: Request, res: Response, next: NextFunction) {
    const provided =
        (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '') ||
        (req.headers['x-ramscraft-token'] || '').toString() ||
        (typeof req.query.token === 'string' ? req.query.token : '');

    if (config.apiToken) {
        if (provided && timingSafeEqual(provided, config.apiToken)) return next();
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // No token configured: allow loopback only (reverse-proxy / RamsesHub model).
    if (isLoopbackAddress(req.ip) || isLoopbackAddress(req.socket.remoteAddress)) return next();
    return res.status(401).json({ error: 'Unauthorized: this instance only accepts local connections. Set RAMSCRAFT_API_TOKEN to allow remote access.' });
}

/** Minimal in-memory rate limiter for state-changing requests (defence in depth). */
const buckets = new Map<string, { count: number; reset: number }>();
export function rateLimit(maxPerMinute = 120) {
    return (req: Request, res: Response, next: NextFunction) => {
        const key = req.ip || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const b = buckets.get(key);
        if (!b || now > b.reset) {
            buckets.set(key, { count: 1, reset: now + 60_000 });
            return next();
        }
        if (b.count >= maxPerMinute) {
            return res.status(429).json({ error: 'Too many requests' });
        }
        b.count++;
        next();
    };
}
