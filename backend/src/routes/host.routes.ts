import { Router } from 'express';
import { MetricsService } from '../services/MetricsService';
import { JavaDiscoveryService } from '../services/JavaDiscoveryService';

const router = Router();
const metricsService = new MetricsService();
const javaDiscovery = new JavaDiscoveryService();

router.get('/metrics/static', (req, res) => {
    res.json(metricsService.getStaticHostMetrics());
});

router.get('/java', async (req, res) => {
    res.json(await javaDiscovery.getAvailableRuntimes());
});

export default router;
