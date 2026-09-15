// Shared HTTP helpers for provider metadata. Modrinth and GitHub require a User-Agent.
export const USER_AGENT = 'RamsCraft (https://github.com/Ramzyayman/ramscraft)';

async function get(url: string, what: string, accept: string): Promise<Response> {
    let res: Response;
    try {
        res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(20_000) });
    } catch (e: any) {
        throw new Error(`${what}: could not reach ${new URL(url).host} (${e.cause?.code || e.name || e.message})`);
    }
    if (!res.ok) throw new Error(`${what}: ${new URL(url).host} returned HTTP ${res.status}`);
    return res;
}

export async function fetchJson<T = any>(url: string, what: string): Promise<T> {
    return (await get(url, what, 'application/json')).json() as Promise<T>;
}

export async function fetchText(url: string, what: string): Promise<string> {
    return (await get(url, what, '*/*')).text();
}

/**
 * Newest first, semver-aware: numeric parts compare as numbers ("1.21.10" > "1.21.9") and a
 * release outranks its own pre-releases ("0.30.1" > "0.30.1-beta.4").
 */
export function compareVersionsDesc(a: string, b: string): number {
    const split = (v: string) => {
        const m = v.match(/^(\d+(?:\.\d+)*)(?:[-+_ ](.*))?$/);
        return m ? { nums: m[1].split('.').map(Number), pre: m[2] ?? null } : { nums: [] as number[], pre: v };
    };
    const x = split(a), y = split(b);
    for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
        const d = (y.nums[i] ?? 0) - (x.nums[i] ?? 0);
        if (d !== 0) return d;
    }
    if (x.pre === y.pre) return 0;
    if (x.pre === null) return -1;
    if (y.pre === null) return 1;
    return y.pre.localeCompare(x.pre, undefined, { numeric: true });
}

/**
 * NeoForge version -> Minecraft version.
 *   20.4.237 -> 1.20.4, 21.0.167 -> 1.21, 21.1.77 -> 1.21.1   (MINOR.PATCH of 1.x)
 *   26.1.2.108 -> 26.1.2, 26.2.0.88 -> 26.2                    (year-based MC versions, build last)
 * Legacy 1.20.1 builds live in net/neoforged/forge as "1.20.1-47.1.106".
 */
export function neoForgeMcVersion(version: string): string | null {
    if (version.startsWith('1.20.1-')) return '1.20.1';
    const m = version.match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(?:-[\w.]+)?$/);
    if (!m) return null; // e.g. "0.25w14craftmine" (April Fools)
    const [, a, b, c, d] = m;
    if (Number(a) >= 26) return d === undefined ? null : c === '0' ? `${a}.${b}` : `${a}.${b}.${c}`;
    if (Number(a) < 20) return null;
    return b === '0' ? `1.${a}` : `1.${a}.${b}`;
}
