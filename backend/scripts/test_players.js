// Self-check for the player-management helpers against real server files.
// Run from backend/ after `npm run build`: node scripts/test_players.js <server-dir>
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { readNbt } = require('../dist/utils/nbt');
const { stripAnsi } = require('../dist/utils/ansi');

const serverDir = process.argv[2] || '/home/ramzy/ramscraft/servers/ramsmc';
const dataDir = [path.join(serverDir, 'world/players/data'), path.join(serverDir, 'world/playerdata')].find(fs.existsSync);
const file = fs.readdirSync(dataDir).find(f => f.endsWith('.dat'));
assert.ok(file, 'no player .dat to test with');

const nbt = readNbt(fs.readFileSync(path.join(dataDir, file)));
assert.strictEqual(nbt.Pos.length, 3);
assert.strictEqual(typeof nbt.Dimension, 'string');
assert.strictEqual(typeof nbt.foodLevel, 'number');
assert.strictEqual(nbt.UUID.length, 4);
assert.ok(Array.isArray(nbt.Inventory));
console.log('nbt ok:', { pos: nbt.Pos.map(n => +n.toFixed(2)), dim: nbt.Dimension, health: nbt.Health, xp: nbt.XpLevel, inv: nbt.Inventory.length, name: nbt.bukkit && nbt.bukkit.lastKnownName });

// Same prefix regex as ProcessService.readConsoleMessages.
const prefix = /\[\d{2}:\d{2}:\d{2}[^\]]*\](?: \[[^\]]*\])?: ?(.*)$/;
const parse = t => stripAnsi(t).split('\n').map(l => (l.match(prefix) || [])[1]).filter(Boolean).map(s => s.trim());
const ESC = String.fromCharCode(27);
assert.deepStrictEqual(parse('[19:00:01] [Server thread/INFO]: Made Steve a server operator\n'), ['Made Steve a server operator']);
assert.deepStrictEqual(parse(`> ${ESC}[K[19:00:01 INFO]: Killed Steve\r\n>`), ['Killed Steve']);
assert.deepStrictEqual(parse('> kill Steve\n'), []);
console.log('console parser ok');
