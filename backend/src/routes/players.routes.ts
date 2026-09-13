import { Router } from 'express';
import { processService } from '../services/ProcessService';
import { prisma } from '../index';
import * as util from 'minecraft-server-util';

const router = Router();

router.get('/:id/players', async (req, res) => {
    try {
        const server = await prisma.server.findUnique({ where: { id: req.params.id } });
        if (!server) return res.status(404).json({ error: 'Server not found' });
        
        const result = await util.status('127.0.0.1', server.port, { timeout: 2000 });
        
        // Return online players
        res.json({
            online: result.players.online,
            max: result.players.max,
            sample: result.players.sample || []
        });
    } catch (e: any) {
        // If server is offline, just return 0
        res.json({
            online: 0,
            max: 0,
            sample: []
        });
    }
});

router.post('/:id/players/command', async (req, res) => {
    try {
        const { command, player } = req.body;
        // Basic proxy for kick, ban, op
        const fullCmd = `${command} ${player}`;
        await processService.sendCommand(req.params.id, fullCmd);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
