export interface IJavaCompatibility {
    minVersion: number;
    recommendedVersion: number;
    // Highest Java major known to run this MC version. Undefined => no known upper
    // bound (e.g. the newest MC where any newer JDK is assumed fine).
    maxVersion?: number;
    // Present for non-standard/unmappable version strings: selection should fall
    // back to the newest installed runtime and warn rather than guess a range.
    unknown?: boolean;
}

export interface ISoftwareRelease {
    id: string;              // Internal ID (e.g., '35', '1.21.1')
    displayVersion: string;  // e.g., '1.21.1-35'
    isStable: boolean;
}

export interface IDownloadInfo {
    url: string;
    checksum?: string;
    checksumAlgo?: 'sha1' | 'sha256';
}

export interface ISoftwareProvider {
    id: string;
    name: string;
    category: string;

    getMcVersions(): Promise<string[]>;
    getReleases(mcVersion: string): Promise<ISoftwareRelease[]>;
    getJavaCompatibility(mcVersion: string, release: ISoftwareRelease): Promise<IJavaCompatibility>;

    getDownloadInfo(mcVersion: string, release: ISoftwareRelease): Promise<IDownloadInfo>;
    // install() is stubbed for Phase 2, implemented in Phase 3/4
    install(serverDir: string, mcVersion: string, release: ISoftwareRelease): Promise<void>;
    getStartupArgs(memoryMin: number, memoryMax: number, jarName: string): string[];
}
