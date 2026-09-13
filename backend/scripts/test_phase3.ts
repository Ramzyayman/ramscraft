
import { prisma } from '../src/index';
import { processService } from '../src/services/ProcessService';
import { ReconciliationService } from '../src/services/ReconciliationService';
import { ServerStatus } from '@ramscraft/shared';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const reconService = new ReconciliationService();

async function runTests() {
    console.log('--- STARTING PHASE 3 E2E TESTS ---');
    
    // 1. Setup mock server in DB
    const serverId = 'test-server-123';
    await prisma.server.upsert({
        where: { id: serverId },
        update: { status: ServerStatus.OFFLINE },
        create: {
            id: serverId,
            name: 'Test Server',
            directoryName: 'test_server',
            minRamMb: 1024,
            maxRamMb: 2048,
            port: 25565,
            status: ServerStatus.OFFLINE,
            eulaAccepted: true
        }
    });

    const serverDir = path.join(process.cwd(), '..', 'servers', 'test_server');
    if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });
    
    // Write EULA
    fs.writeFileSync(path.join(serverDir, 'eula.txt'), 'eula=true\n');
    
    // Create a fake server.jar (a bash script masquerading as Java to mock Minecraft's lifecycle)
    // It listens on 25565 (simulating ONLINE)
    
    // Create a fake server.jar (a node script masquerading as Java to mock Minecraft's lifecycle)
    fs.writeFileSync(path.join(serverDir, 'server.jar'), `
const net = require('net');
console.log("Starting fake minecraft server...");
setTimeout(() => {
    console.log("Done! For help, type \"help\"");
    const server = net.createServer((c) => {
        // Just accept and close to simulate ping
        c.end();
    });
    server.listen(25565, () => {
        console.log("Listening on 25565");
    });
    
    // Read from stdin to simulate console commands
    process.stdin.on('data', (data) => {
        const cmd = data.toString().trim();
        if (cmd === 'stop') {
            console.log("Stopping server...");
            server.close();
            process.exit(0);
        } else {
            console.log("Unknown command");
        }
    });
}, 2000);
`);


    // We start it using bash -c "exec -a java bash server.jar" so ps shows 'java'
    console.log('1. Starting fake Minecraft server inside tmux...');
    const startCmd = `node server.jar`;
    await processService.startServer(serverId, startCmd, serverDir);

    const s1 = await prisma.server.findUnique({ where: { id: serverId }});
    console.log('Status after start:', s1?.status);
    
    console.log('Waiting 3 seconds for it to bind port...');
    await new Promise(r => setTimeout(r, 3000));
    
    console.log('2. Testing Reconciliation (Simulating backend restart)');
    // Change state to STARTING to see if it moves to ONLINE
    await prisma.server.update({ where: { id: serverId }, data: { status: ServerStatus.STARTING } });
    await reconService.reconcileOnStartup();
    
    const s2 = await prisma.server.findUnique({ where: { id: serverId }});
    console.log('Status after reconciliation (Should be ONLINE):', s2?.status);

    console.log('3. Fetching Console History');
    const history = await processService.getConsoleHistory(serverId);
    console.log('Console output:\n', history);

    console.log('4. Stopping Server Gracefully');
    await processService.stopServer(serverId, 5000);
    
    const s3 = await prisma.server.findUnique({ where: { id: serverId }});
    console.log('Status after stop:', s3?.status);
    
    console.log('--- TESTS COMPLETE ---');
}

runTests().catch(console.error).finally(() => process.exit(0));
