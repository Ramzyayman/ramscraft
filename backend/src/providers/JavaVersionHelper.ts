import { IJavaCompatibility } from './ISoftwareProvider';

export class JavaVersionHelper {
    public static parseVersion(version: string): number[] {
        return version.split('.').map(v => parseInt(v.replace(/[^0-9]/g, ''), 10));
    }

    public static isGreaterThanOrEqual(target: string, base: string): boolean {
        const v1 = this.parseVersion(target);
        const v2 = this.parseVersion(base);
        for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
            const p1 = v1[i] || 0;
            const p2 = v2[i] || 0;
            if (p1 > p2) return true;
            if (p1 < p2) return false;
        }
        return true;
    }

    public static getStandardJavaRules(mcVersion: string): IJavaCompatibility {
        if (this.isGreaterThanOrEqual(mcVersion, '26.1')) {
            return { minVersion: 25, recommendedVersion: 25, supportedVersions: [25] };
        }
        if (this.isGreaterThanOrEqual(mcVersion, '1.20.5')) {
            return { minVersion: 21, recommendedVersion: 21, supportedVersions: [21] };
        }
        if (this.isGreaterThanOrEqual(mcVersion, '1.18.0')) {
            return { minVersion: 17, recommendedVersion: 17, supportedVersions: [17, 21] };
        }
        if (this.isGreaterThanOrEqual(mcVersion, '1.17.0')) {
            return { minVersion: 16, recommendedVersion: 16, supportedVersions: [16, 17] };
        }
        return { minVersion: 8, recommendedVersion: 8, supportedVersions: [8, 11] };
    }
}
