import { ISoftwareProvider, ISoftwareRelease, IJavaCompatibility } from './ISoftwareProvider';
import { cacheService } from '../services/MetadataCacheService';
import { JavaVersionHelper } from './JavaVersionHelper';

export class PaperProvider implements ISoftwareProvider {
    id = 'paper';
    name = 'Paper';
    category = 'High Performance Plugins';

    private BASE_URL = 'https://api.papermc.io/v2/projects/paper';
    private CACHE_TTL = 1000 * 60 * 60 * 1; // 1 hour for Paper builds

    async getMcVersions(): Promise<string[]> {
        return cacheService.getCachedOrFetch(this.id, 'mc_versions', this.CACHE_TTL, async () => {
            const response = await fetch(this.BASE_URL);
            if (!response.ok) throw new Error('Failed to fetch Paper versions');
            const data = await response.json();
            return data.versions.reverse(); // Newest first
        });
    }

    async getReleases(mcVersion: string): Promise<ISoftwareRelease[]> {
        return cacheService.getCachedOrFetch(this.id, `releases_${mcVersion}`, this.CACHE_TTL, async () => {
            const response = await fetch(`${this.BASE_URL}/versions/${mcVersion}`);
            if (!response.ok) throw new Error('Failed to fetch Paper builds');
            const data = await response.json();
            
            if (!data.builds) return [];
            
            // Paper provides an array of build numbers
            return data.builds.reverse().map((build: number) => ({
                id: build.toString(),
                displayVersion: `${mcVersion}-#${build}`,
                isStable: true // Paper v2 API generally lists stable/experimental, we'll assume stable for MVP
            }));
        });
    }

    async getJavaCompatibility(mcVersion: string): Promise<IJavaCompatibility> {
        return JavaVersionHelper.getStandardJavaRules(mcVersion);
    }

    async getDownloadInfo(mcVersion: string, release: ISoftwareRelease): Promise<{ url: string, checksum?: string }> {
        const build = release.id;
        const jarName = `paper-${mcVersion}-${build}.jar`;
        const url = `${this.BASE_URL}/versions/${mcVersion}/builds/${build}/downloads/${jarName}`;
        
        // Fetch checksum
        const response = await fetch(`${this.BASE_URL}/versions/${mcVersion}/builds/${build}`);
        if (!response.ok) throw new Error('Failed to fetch build checksum');
        const data = await response.json();
        const checksum = data.downloads?.application?.sha256;

        return { url, checksum };
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
