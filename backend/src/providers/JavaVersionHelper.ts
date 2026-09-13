import { IJavaCompatibility } from './ISoftwareProvider';

/**
 * Maps a Minecraft version string to the Java major-version range that can run it.
 *
 * Handles: modern releases (1.x.y and the 26.x scheme), release-candidate/pre
 * strings (e.g. "26.3-rc-1", "1.21-pre1"), and week snapshots ("24w14a"). Unknown
 * or unmappable strings are flagged so the runtime selector can fall back to the
 * newest installed JDK rather than mis-classifying (the previous implementation
 * parsed "24w14a" as 2414 and demanded Java 25).
 */
export class JavaVersionHelper {
    /** Comparable integer for a release tuple: major*1e6 + minor*1e3 + patch. */
    private static toComparable(major: number, minor: number, patch = 0): number {
        return major * 1_000_000 + minor * 1_000 + patch;
    }

    /**
     * Normalise a version string to a comparable release number, or null if it is
     * not a recognisable release/rc/pre/snapshot.
     */
    static normalize(version: string): number | null {
        const v = version.trim();

        // Release or rc/pre: leading "MAJOR.MINOR[.PATCH]" optionally followed by
        // -rc / -pre / _rc etc. We only need the leading numeric release part.
        const rel = v.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
        if (rel && /^[\d.]+([-_ ]?(rc|pre|snapshot)|$)/i.test(v)) {
            return this.toComparable(Number(rel[1]), Number(rel[2]), Number(rel[3] || 0));
        }
        if (rel && /^\d+\.\d+(\.\d+)?$/.test(v)) {
            return this.toComparable(Number(rel[1]), Number(rel[2]), Number(rel[3] || 0));
        }

        // Week snapshot: YYwWW[letter] -> map to the release era it precedes.
        const snap = v.match(/^(\d{2})w(\d{2})[a-z]$/i);
        if (snap) {
            const year = Number(snap[1]);
            const week = Number(snap[2]);
            return this.snapshotToComparable(year, week);
        }

        return null;
    }

    private static snapshotToComparable(year: number, week: number): number {
        // Approximate mapping of snapshot year/week to the release under development.
        if (year >= 26) return this.toComparable(26, 1, 0);   // 26.x dev -> Java 25 tier
        if (year === 25) return this.toComparable(1, 21, 6);  // 1.21.x/1.22 dev -> Java 21
        if (year === 24) return this.toComparable(1, 21, 0);  // 1.20.5/1.21 dev -> Java 21
        if (year === 23) return this.toComparable(1, 20, 0);  // 1.20 dev -> Java 17
        if (year === 22) return this.toComparable(1, 19, 0);  // 1.19 dev -> Java 17
        if (year === 21) return week >= 37 ? this.toComparable(1, 18, 0) // 1.18 dev
                                           : this.toComparable(1, 17, 0); // 1.17 dev -> Java 16
        return this.toComparable(1, 16, 0); // older -> Java 8/11 tier
    }

    static getStandardJavaRules(mcVersion: string): IJavaCompatibility {
        const c = this.normalize(mcVersion);
        if (c === null) {
            // Unknown string (odd snapshot, april-fools, etc.): don't guess a range.
            return { minVersion: 21, recommendedVersion: 21, unknown: true };
        }
        if (c >= this.toComparable(26, 1)) {
            return { minVersion: 25, recommendedVersion: 25 };
        }
        if (c >= this.toComparable(1, 20, 5)) {
            return { minVersion: 21, recommendedVersion: 21, maxVersion: 21 };
        }
        if (c >= this.toComparable(1, 18, 0)) {
            return { minVersion: 17, recommendedVersion: 17, maxVersion: 21 };
        }
        if (c >= this.toComparable(1, 17, 0)) {
            return { minVersion: 16, recommendedVersion: 17, maxVersion: 17 };
        }
        if (c >= this.toComparable(1, 13, 0)) {
            return { minVersion: 8, recommendedVersion: 8, maxVersion: 16 };
        }
        return { minVersion: 8, recommendedVersion: 8, maxVersion: 11 };
    }
}
