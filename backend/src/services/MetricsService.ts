import os from 'os';

export class MetricsService {
    public getStaticHostMetrics() {
        return {
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            cpus: os.cpus().length,
            totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
            freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
            uptimeSeconds: os.uptime()
        };
    }
}
