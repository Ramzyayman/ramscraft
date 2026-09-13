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

// Allowed player-management commands (maps UI action -> Minecraft command).
const ALLOWED_COMMANDS = new Set(['kick', 'ban', 'pardon', 'op', 'deop', 'whitelist add', 'whitelist remove']);

router.post('/:id/players/command', async (req, res) => {
    try {
        const { command, player } = req.body;
        // Command must be from the fixed allow-list; player must be a valid MC username.
        // (Even so, sendCommand uses argv/no-shell, so this is defence in depth.)
        if (typeof command !== 'string' || !ALLOWED_COMMANDS.has(command)) {
            return res.status(400).json({ error: 'Unsupported command' });
        }
        if (typeof player !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(player)) {
            return res.status(400).json({ error: 'Invalid player name' });
        }
        await processService.sendCommand(req.params.id, `${command} ${player}`);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
