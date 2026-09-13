
import { prisma } from '../src/index';
import { processService } from '../src/services/ProcessService';
import { ReconciliationService } from '../src/services/ReconciliationService';
import { ServerStatus } from '@ramscraft/shared';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import net from 'net';

const reconService = new ReconciliationService();

async function pingPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);
        socket.on('connect', () => { socket.destroy(); resolve(true); });
        socket.on('error', () => { socket.destroy(); resolve(false); });
        socket.on('timeout', () => { socket.destroy(); resolve(false); });
        socket.connect(port, '127.0.0.1');
    });
}

async function runTests() {
    console.log('--- STARTING REAL MINECRAFT E2E TEST ---');
    
    const serverId = 'real-mc-123';
    const serverDir = path.join(process.cwd(), '..', 'servers', 'real_server');
    if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });
    
    // 1. Download real PaperMC JAR if missing
    const jarPath = path.join(serverDir, 'server.jar');
    if (!fs.existsSync(jarPath)) {
        console.log('Downloading Vanilla 1.20.4...');
        execSync('curl -s -o server.jar "https://piston-data.mojang.com/v1/objects/8dd1a28015f51b1803213892b50b7b4fc76e594d/server.jar"', { cwd: serverDir });
    }
    
    // Write EULA
    fs.writeFileSync(path.join(serverDir, 'eula.txt'), 'eula=true\n');
    
    // Clean up log file
    const logPath = processService.getLogFilePath(serverId);
    if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
    
    // Clean up any stale tmux
    
    // Setup DB
    await prisma.server.deleteMany({});
    await prisma.server.upsert({
        where: { id: serverId },
        update: { status: ServerStatus.OFFLINE, tmuxSessionName: null, lastKnownPid: null },
        create: {
            id: serverId,
            name: 'Real Server',
            directoryName: 'real_server',
            minRamMb: 1024,
            maxRamMb: 2048,
            port: 25565,
            status: ServerStatus.OFFLINE,
            eulaAccepted: true
        }
    });

    // Clean up any stale tmux
    await processService.forceKill(serverId);


    console.log('1. Starting Real Minecraft server inside tmux...');
    const startCmd = `java -Xms1G -Xmx1G -jar server.jar nogui`;
    await processService.startServer(serverId, startCmd, serverDir);

    let isOnline = false;
    console.log('Waiting for Minecraft to fully boot (this may take 15-30s)...');
    for (let i = 0; i < 45; i++) {
        isOnline = await pingPort(25565);
        if (isOnline) break;
        await new Promise(r => setTimeout(r, 1000));
    }
    
    if (!isOnline) {
        console.error('Server failed to bind port 25565 in time!');
        const hist = await processService.getConsoleHistory(serverId, 100);
        console.log(hist);
        process.exit(1);
    }
    console.log('Minecraft is ONLINE on port 25565!');
    
    console.log('2. Testing Reconciliation (Simulating backend restart)');
    // Simulate backend restart by resetting status in DB to a bad state
    await prisma.server.update({ where: { id: serverId }, data: { status: ServerStatus.OFFLINE } });
    
    // Run reconciliation
    await reconService.reconcileOnStartup();
    
    const s2 = await prisma.server.findUnique({ where: { id: serverId }});
    console.log('Status after reconciliation (Should be ONLINE):', s2?.status);
    if (s2?.status !== ServerStatus.ONLINE) {
        console.error('Reconciliation failed to detect ONLINE state!');
        process.exit(1);
    }

    console.log('3. Testing persistent console and command execution after restart...');
    const testCommand = 'say RamsCraft Recovery Test Successful';
    await processService.sendCommand(serverId, testCommand);
    
    console.log('Waiting 2 seconds for output to flush...');
    await new Promise(r => setTimeout(r, 2000));
    
    const history = await processService.getConsoleHistory(serverId, 50);
    if (history.includes('RamsCraft Recovery Test Successful')) {
        console.log('? Command executed successfully and was found in persistent log pipe!');
    } else {
        console.error('? Command output not found in log! Pipe might be broken after restart.');
        console.log('Current History:', history);
        process.exit(1);
    }

    console.log('4. Stopping Server Gracefully...');
    await processService.stopServer(serverId, 30000); // Wait up to 30s
    
    const s3 = await prisma.server.findUnique({ where: { id: serverId }});
    console.log('Status after stop:', s3?.status);
    
    const hasSession = await processService.hasSession(serverId);
    console.log('Tmux session exists:', hasSession);
    
    if (s3?.status === ServerStatus.OFFLINE && !hasSession) {
        console.log('? Server stopped cleanly with no orphans.');
    } else {
        console.error('? Server did not stop cleanly!');
        process.exit(1);
    }
    
    console.log('--- REAL E2E TESTS COMPLETE ---');
}

runTests().catch(console.error).finally(() => process.exit(0));
