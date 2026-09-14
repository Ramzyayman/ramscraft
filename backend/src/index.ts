import express from 'express';
import http from 'http';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { config, isLoopbackAddress } from './config';
import serverRoutes from './routes/server.routes';
import hostRoutes from './routes/host.routes';
import softwareRoutes from './routes/software.routes';
import filesRoutes from './routes/files.routes';
import settingsRoutes from './routes/settings.routes';
import backupsRoutes from './routes/backups.routes';
import playersRoutes from './routes/players.routes';
import worldsRoutes from './routes/worlds.routes';
import { ReconciliationService } from './services/ReconciliationService';
import { wsService } from './services/WebSocketService';
import { MetricsStreamer } from './services/MetricsStreamer';
import { JavaDiscoveryService } from './services/JavaDiscoveryService';
import { consoleStreamer } from './services/ConsoleStreamer';
import { authGuard, rateLimit } from './middleware/auth';

export const prisma = new PrismaClient();
const app = express();
app.set('trust proxy', true); // behind nginx/RamsesHub; makes req.ip meaningful

// Basic security headers (no external dep).
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

// Same-origin by default; cross-origin only for explicitly allowed origins.
app.use(cors({ origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : false }));
app.use(express.json({ limit: '2mb' }));

// Every management API call is authenticated + rate-limited.
app.use('/api', rateLimit(240), authGuard);

app.use('/api/servers', serverRoutes);
app.use('/api/host', hostRoutes);
app.use('/api/software', softwareRoutes);
app.use('/api/servers', filesRoutes);
app.use('/api/servers', settingsRoutes);
app.use('/api/servers', backupsRoutes);
app.use('/api/servers', playersRoutes);
app.use('/api/servers', worldsRoutes);

// Serve the built frontend.
const frontendDist = require('path').join(process.cwd(), '..', 'frontend', 'dist');
app.use(express.static(frontendDist));
app.use((req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(require('path').join(frontendDist, 'index.html'));
    } else {
        res.status(404).json({ error: 'API Route Not Found' });
    }
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

async function bootstrap() {
    try {
        // Fail closed: never expose the API on a network interface without a token.
        if (!isLoopbackAddress(config.host) && config.host !== 'localhost' && !config.apiToken) {
            console.error(
                `Refusing to bind to ${config.host} without RAMSCRAFT_API_TOKEN set. ` +
                `Set a token to expose on the network, or bind to 127.0.0.1 (default) behind a proxy.`
            );
            process.exit(1);
        }

        await prisma.$connect();
        console.log('Connected to SQLite Database.');

        const javaDiscovery = new JavaDiscoveryService();
        await javaDiscovery.discoverInstalledRuntimes();

        const reconciliationService = new ReconciliationService();
        await reconciliationService.reconcileOnStartup();

        const server = http.createServer(app);
        wsService.init(server);
        const metricsStreamer = new MetricsStreamer(wsService.io);
        metricsStreamer.start();

        server.listen(config.port, config.host, () => {
            console.log(`RamsCraft Backend listening on http://${config.host}:${config.port}`);
            if (!config.apiToken && isLoopbackAddress(config.host)) {
                console.log('[auth] Loopback-only mode (no token). Front with nginx/RamsesHub or set RAMSCRAFT_API_TOKEN for remote access.');
            }
        });

        // Graceful shutdown. systemd runs this unit with KillMode=process so that the
        // Minecraft servers (detached tmux sessions) survive a backend restart; that
        // makes OUR OWN children (the console `tail` processes) our responsibility.
        // Stopping them here prevents orphan accumulation without any pattern-killing.
        let shuttingDown = false;
        const shutdown = (signal: string) => {
            if (shuttingDown) return;
            shuttingDown = true;
            console.log(`[shutdown] ${signal} received; stopping console streams.`);
            try { consoleStreamer.stopAll(); } catch { /* best effort */ }
            metricsStreamer.stop();
            server.close(() => process.exit(0));
            // Don't hang forever on lingering sockets.
            setTimeout(() => process.exit(0), 3000).unref();
        };
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
    } catch (error) {
        console.error('Failed to start RamsCraft:', error);
        process.exit(1);
    }
}

bootstrap();
