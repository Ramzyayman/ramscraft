import { ISoftwareProvider, ISoftwareRelease, IJavaCompatibility, IDownloadInfo } from './ISoftwareProvider';
import { cacheService } from '../services/MetadataCacheService';
import { JavaVersionHelper } from './JavaVersionHelper';

export class PaperProvider implements ISoftwareProvider {
    id = 'paper';
    name = 'Paper';
    category = 'High Performance Plugins';

    private BASE_URL = 'https://fill.papermc.io/v3/projects/paper';
    private CACHE_TTL = 1000 * 60 * 60 * 1; // 1 hour for Paper builds

    async getMcVersions(): Promise<string[]> {
        return cacheService.getCachedOrFetch(this.id, 'mc_versions', this.CACHE_TTL, async () => {
            const response = await fetch(this.BASE_URL);
            if (!response.ok) throw new Error('Failed to fetch Paper versions');
            const data = await response.json();
            
            const allVersions: string[] = [];
            if (data.versions) {
                // The new v3 API groups versions by major release (e.g. "1.21" -> ["1.21.11", ...])
                for (const group of Object.values(data.versions)) {
                    if (Array.isArray(group)) {
                        allVersions.push(...group);
                    }
                }
            }
            return allVersions;
        });
    }

    async getReleases(mcVersion: string): Promise<ISoftwareRelease[]> {
        return cacheService.getCachedOrFetch(this.id, `releases_${mcVersion}`, this.CACHE_TTL, async () => {
            const response = await fetch(`${this.BASE_URL}/versions/${mcVersion}/builds`);
            if (!response.ok) throw new Error('Failed to fetch Paper builds');
            const data = await response.json();
            
            if (!Array.isArray(data)) return [];
            
            // v3 API returns an array of build objects (newest first)
            return data.map((build: any) => ({
                id: build.id.toString(),
                displayVersion: `${mcVersion}-#${build.id}`,
                isStable: build.channel !== 'EXPERIMENTAL'
            }));
        });
    }

    async getJavaCompatibility(mcVersion: string): Promise<IJavaCompatibility> {
        return JavaVersionHelper.getStandardJavaRules(mcVersion);
    }

    async getDownloadInfo(mcVersion: string, release: ISoftwareRelease): Promise<IDownloadInfo> {
        const response = await fetch(`${this.BASE_URL}/versions/${mcVersion}/builds`);
        if (!response.ok) throw new Error('Failed to fetch build checksum');
        const data = await response.json();

        const build = data.find((b: any) => b.id.toString() === release.id);
        if (!build || !build.downloads || !build.downloads['server:default']) {
            throw new Error('Build download not found');
        }

        const downloadInfo = build.downloads['server:default'];
        return {
            url: downloadInfo.url,
            checksum: downloadInfo.checksums?.sha256,
            checksumAlgo: 'sha256'
        };
    }

    async install(serverDir: string, mcVersion: string, release: ISoftwareRelease): Promise<void> {
        console.log(`[PaperProvider] Installation prepared for ${mcVersion} build ${release.id}`);
    }

    getStartupArgs(memoryMin: number, memoryMax: number, jarName: string): string[] {
        // Aikar's flags are recommended for Paper
        return [
            '-Xms' + memoryMin + 'M', 
            '-Xmx' + memoryMax + 'M', 
            '-XX:+UseG1GC',
            '-XX:+ParallelRefProcEnabled',
            '-XX:MaxGCPauseMillis=200',
            '-XX:+UnlockExperimentalVMOptions',
            '-XX:+DisableExplicitGC',
            '-XX:+AlwaysPreTouch',
            '-XX:G1NewSizePercent=30',
            '-XX:G1MaxNewSizePercent=40',
            '-XX:G1HeapRegionSize=8M',
            '-XX:G1ReservePercent=20',
            '-XX:G1HeapWastePercent=5',
            '-XX:G1MixedGCCountTarget=4',
            '-XX:InitiatingHeapOccupancyPercent=15',
            '-XX:G1MixedGCLiveThresholdPercent=90',
            '-XX:G1RSetUpdatingPauseTimePercent=5',
            '-XX:SurvivorRatio=32',
            '-XX:+PerfDisableSharedMem',
            '-XX:MaxTenuringThreshold=1',
            '-Dusing.aikars.flags=https://mcflags.emc.gs',
            '-Daikars.new.flags=true',
            '-jar', jarName, 'nogui'
        ];
    }
}
