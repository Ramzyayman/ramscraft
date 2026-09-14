import { LaunchConfig } from './launch';

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
    mcVersion?: string;      // When the version step isn't a Minecraft version (modpacks)
}

/** A choice in the version step when it isn't a plain Minecraft version string (e.g. a modpack). */
export interface IVersionOption {
    id: string;
    label: string;
}

export type HashAlgo = 'sha1' | 'sha256' | 'sha512' | 'md5';

export interface IDownloadInfo {
    url: string;
    checksum?: string;
    checksumAlgo?: HashAlgo;
}

/** Services the install engine gives a provider. Everything happens inside stagingDir. */
export interface InstallContext {
    stagingDir: string;
    /** Shared across installs and servers (installers, BuildTools work tree). */
    cacheDir: string;
    mcVersion: string;
    release: ISoftwareRelease;
    /** Path to an installed Java runtime compatible with this Minecraft version. Throws an actionable error otherwise. */
    java(mcVersion?: string): Promise<string>;
    progress(phase: string, percent?: number | null, detail?: string): void;
    download(url: string, dest: string, opts?: { checksum?: string; algo?: HashAlgo; label?: string; quiet?: boolean }): Promise<void>;
    /** Run a process (argv, no shell) streaming its output as progress; rejects on non-zero exit. */
    run(file: string, args: string[], opts: { cwd: string; label: string; timeoutMs?: number; until?: RegExp }): Promise<void>;
}

export interface InstallResult {
    launch: LaunchConfig;
    /** Top-level entries in stagingDir to install into the server directory. */
    files: string[];
    /** Directories replaced wholesale instead of merged (default: ['libraries']). */
    replace?: string[];
    /** Resolved Minecraft version when it isn't the selected one (modpacks). */
    mcVersion?: string;
    /** What "Release" shows in Current Software (default: release.id). */
    releaseLabel?: string;
    /** Where the software came from, for the Software record. */
    sourceUrl?: string;
}

export interface ISoftwareProvider {
    id: string;
    name: string;
    category: string;
    /** Labels for the version and release steps of the Change Software flow. */
    labels: { version: string; release: string };
    /** Short explanation shown under the provider picker. */
    note?: string;
    /** The version step is a search (modpacks) instead of a fixed list. */
    searchable?: boolean;

    getMcVersions(query?: string): Promise<(string | IVersionOption)[]>;
    getReleases(mcVersion: string): Promise<ISoftwareRelease[]>;
    getJavaCompatibility(mcVersion: string, release: ISoftwareRelease): Promise<IJavaCompatibility>;

    install(ctx: InstallContext): Promise<InstallResult>;
    getStartupArgs(memoryMin: number, memoryMax: number, launch: LaunchConfig): string[];
}
