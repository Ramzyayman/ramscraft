import { prisma } from '../index';
import { JavaVersionHelper } from '../providers/JavaVersionHelper';

export interface SelectedJava {
    id: string;
    path: string;
    majorVersion: number;
}

/**
 * Pick an installed Java runtime that can actually run the given Minecraft version,
 * honouring BOTH the minimum and the maximum supported major (the old code checked
 * only the minimum, so e.g. a 1.16 server would auto-pick Java 21 and fail to boot).
 *
 * @param mcVersion  Minecraft version string.
 * @param configuredId  Optional runtime the user pinned on the server; used only if compatible.
 * @throws Error with an actionable message if no installed runtime is compatible.
 */
export async function selectJavaRuntime(mcVersion: string, configuredId?: string | null): Promise<SelectedJava> {
    const rules = JavaVersionHelper.getStandardJavaRules(mcVersion);
    const runtimes = await prisma.javaRuntime.findMany({ orderBy: { majorVersion: 'asc' } });

    if (runtimes.length === 0) {
        throw new Error('No Java runtimes are installed on the host. Install a JDK and restart the RamsCraft backend.');
    }

    const inRange = (major: number) =>
        major >= rules.minVersion && (rules.maxVersion === undefined || major <= rules.maxVersion);

    // For unmappable version strings, fall back to the newest installed runtime.
    if (rules.unknown) {
        const newest = runtimes[runtimes.length - 1];
        return { id: newest.id, path: newest.path, majorVersion: newest.majorVersion };
    }

    // Honour a user-pinned runtime if it is compatible.
    if (configuredId) {
        const pinned = runtimes.find(r => r.id === configuredId);
        if (pinned && inRange(pinned.majorVersion)) {
            return { id: pinned.id, path: pinned.path, majorVersion: pinned.majorVersion };
        }
    }

    const compatible = runtimes.filter(r => inRange(r.majorVersion));
    if (compatible.length === 0) {
        const installed = [...new Set(runtimes.map(r => r.majorVersion))].sort((a, b) => a - b).join(', ');
        const range = rules.maxVersion !== undefined
            ? `Java ${rules.minVersion}-${rules.maxVersion}`
            : `Java ${rules.minVersion}+`;
        throw new Error(
            `Minecraft ${mcVersion} requires ${range}, but only Java ${installed} is installed. ` +
            `Install a compatible JDK and restart the RamsCraft backend.`
        );
    }

    // Prefer the recommended major, else the closest compatible one to it.
    const exact = compatible.find(r => r.majorVersion === rules.recommendedVersion);
    const chosen = exact
        ?? compatible.reduce((best, r) =>
            Math.abs(r.majorVersion - rules.recommendedVersion) < Math.abs(best.majorVersion - rules.recommendedVersion) ? r : best
        );
    return { id: chosen.id, path: chosen.path, majorVersion: chosen.majorVersion };
}
