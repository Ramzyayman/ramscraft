export interface IJavaCompatibility {
    minVersion: number;
    recommendedVersion?: number;
    supportedVersions?: number[];
}

export interface ISoftwareRelease {
    id: string;              // Internal ID (e.g., '35', '1.21.1')
    displayVersion: string;  // e.g., '1.21.1-35'
    isStable: boolean;
}

export interface ISoftwareProvider {
    id: string;
    name: string;
    category: string;
    
    getMcVersions(): Promise<string[]>;
    getReleases(mcVersion: string): Promise<ISoftwareRelease[]>;
    getJavaCompatibility(mcVersion: string, release: ISoftwareRelease): Promise<IJavaCompatibility>;
    
    getDownloadInfo(mcVersion: string, release: ISoftwareRelease): Promise<{ url: string, checksum?: string }>;
    // install() is stubbed for Phase 2, implemented in Phase 3/4
    install(serverDir: string, mcVersion: string, release: ISoftwareRelease): Promise<void>;
    getStartupArgs(memoryMin: number, memoryMax: number, jarName: string): string[];
}
