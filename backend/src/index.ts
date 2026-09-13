
import express from 'express';
import http from 'http';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import serverRoutes from './routes/server.routes';
import hostRoutes from './routes/host.routes';
import softwareRoutes from './routes/software.routes';
import filesRoutes from './routes/files.routes';
import settingsRoutes from './routes/settings.routes';
import backupsRoutes from './routes/backups.routes';
import playersRoutes from './routes/players.routes';
import { ReconciliationService } from './services/ReconciliationService';
import { wsService } from './services/WebSocketService';
import { MetricsStreamer } from './services/MetricsStreamer';

export const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// REST Routes
app.use('/api/servers', serverRoutes);
app.use('/api/host', hostRoutes);
app.use('/api/software', softwareRoutes);

// File, Setting, Backup, Player routes
app.use('/api/servers', filesRoutes);
app.use('/api/servers', settingsRoutes);
app.use('/api/servers', backupsRoutes);
app.use('/api/servers', playersRoutes);

// Serve Frontend
const frontendDist = require('path').join(process.cwd(), '..', 'frontend', 'dist');
app.use(express.static(frontendDist));

// Catch-all route to serve the frontend for any non-API routes, or return 404 for API routes
app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(require('path').join(frontendDist, 'index.html'));
    } else {
        res.status(404).json({error: 'API Route Not Found'});
    }
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

async function bootstrap() {
    try {
        await prisma.$connect();
        console.log('Connected to SQLite Database.');
        
        const reconciliationService = new ReconciliationService();
        await reconciliationService.reconcileOnStartup();

        const server = http.createServer(app);
        wsService.init(server);
        const metricsStreamer = new MetricsStreamer(wsService.io);
        metricsStreamer.start();

        server.listen(Number(PORT), '0.0.0.0', () => {
            console.log(`RamsCraft Backend listening on http://0.0.0.0:${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start RamsCraft:', error);
        process.exit(1);
    }
}

bootstrap();
