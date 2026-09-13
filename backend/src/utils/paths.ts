import path from 'path';
import fs from 'fs';
import { config } from '../config';

/**
 * The absolute, canonical directory for a server. directoryName is app-generated
 * and sanitised at creation, but we still resolve + verify it stays inside the
 * servers root (defence in depth).
 */
export function serverRoot(directoryName: string): string {
    const root = path.resolve(config.serversRoot);
    const full = path.resolve(root, directoryName);
    if (full !== path.join(root, directoryName) || !isInside(root, full)) {
        throw new Error('Invalid server directory');
    }
    return full;
}

/** True if `child` is the root itself or strictly contained within it. */
export function isInside(root: string, child: string): boolean {
    const r = path.resolve(root);
    const c = path.resolve(child);
    if (c === r) return true;
    return c.startsWith(r + path.sep);
}

/**
 * Resolve a client-supplied relative path against a server root and guarantee the
 * result cannot escape the root via `..`, absolute paths, sibling-prefix tricks,
 * or symlinks. Returns the safe absolute path.
 *
 * `mustExist` controls whether symlink resolution is enforced on the full target
 * (for reads/deletes) or only on the deepest existing ancestor (for creates).
 */
export function resolveWithinServer(directoryName: string, requested: string): string {
    const root = serverRoot(directoryName);
    // Treat the requested path as relative to the root regardless of leading slash.
    const rel = requested.replace(/^[/\\]+/, '');
    const target = path.resolve(root, rel);

    // Lexical containment check (handles .., and sibling-prefix because we compare
    // against root + separator).
    if (!isInside(root, target)) {
        throw new PathEscapeError();
    }

    // Symlink containment: resolve the realpath of the deepest existing ancestor
    // and ensure it is still inside the (real) root. This defeats symlinks that
    // point outside the tree.
    const realRoot = fs.realpathSync(root);
    let probe = target;
    while (!fs.existsSync(probe)) {
        const parent = path.dirname(probe);
        if (parent === probe) break;
        probe = parent;
    }
    const realProbe = fs.realpathSync(probe);
    if (!isInside(realRoot, realProbe)) {
        throw new PathEscapeError();
    }
    return target;
}

export class PathEscapeError extends Error {
    constructor() {
        super('Access denied: path escapes server root');
        this.name = 'PathEscapeError';
    }
}

/** Sanitise a user-supplied name into a safe directory slug, guaranteed non-empty. */
export function slugifyServerName(name: string): string {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || 'server';
}
