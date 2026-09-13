import { prisma } from '../index';

export class JavaDiscoveryService {
    public async discoverInstalledRuntimes(): Promise<void> {
        // Phase 1 Stub: In the future, this will scan /usr/lib/jvm or Windows Program Files
        // and populate the JavaRuntime table in SQLite.
        console.log('JavaDiscoveryService: Scanning for Java runtimes (Stubbed)');
    }
    
    public async getAvailableRuntimes() {
        return await prisma.javaRuntime.findMany();
    }
}
