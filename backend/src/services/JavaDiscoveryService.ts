import { prisma } from '../index';
import { run } from '../utils/exec';
import fs from 'fs';
import path from 'path';

export class JavaDiscoveryService {
    public async discoverInstalledRuntimes(): Promise<void> {
        console.log('[JavaDiscovery] Scanning for Java runtimes...');
        const searchDirs = ['/usr/lib/jvm'];
        
        for (const dir of searchDirs) {
            if (!fs.existsSync(dir)) continue;
            
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() || entry.isSymbolicLink()) {
                    const javaPath = path.join(dir, entry.name, 'bin', 'java');
                    if (fs.existsSync(javaPath)) {
                        try {
                            const { stderr, stdout } = await run(javaPath, ['-version'], { timeoutMs: 10000 });
                            // Version output is on stderr for most JDKs: openjdk version "21.0.1" ...
                            const versionMatch = (stderr || stdout).match(/version "([^"]+)"/);
                            if (versionMatch) {
                                const fullVersion = versionMatch[1];
                                const major = parseInt(fullVersion.split('.')[0], 10);
                                const actualMajor = major === 1 ? parseInt(fullVersion.split('.')[1], 10) : major;
                                
                                const existing = await prisma.javaRuntime.findFirst({
                                    where: { path: javaPath }
                                });
                                
                                if (!existing) {
                                    await prisma.javaRuntime.create({
                                        data: {
                                            name: `Java ${actualMajor} (${entry.name})`,
                                            path: javaPath,
                                            majorVersion: actualMajor
                                        }
                                    });
                                    console.log(`[JavaDiscovery] Registered Java ${actualMajor} at ${javaPath}`);
                                }
                            }
                        } catch (e) {
                            console.error(`[JavaDiscovery] Failed to probe ${javaPath}`, e);
                        }
                    }
                }
            }
        }
    }
    
    public async getAvailableRuntimes() {
        return await prisma.javaRuntime.findMany({ orderBy: { majorVersion: 'desc' } });
    }
}
