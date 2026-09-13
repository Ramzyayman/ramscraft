import { io } from 'socket.io-client';
import { prisma } from '../src/index';
import { processService } from '../src/services/ProcessService';
import { ServerStatus } from '@ramscraft/shared';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runPhase4Test() {
    console.log('--- STARTING PHASE 4 E2E TEST ---');
    const serverId = 'real-mc-123';
    
    // Check if server is running from our previous Phase 3 test, or start it
    let server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server || server.status !== ServerStatus.ONLINE) {
        console.log('Starting server for Phase 4...');
        const serverDir = require('path').join(process.cwd(), '..', 'servers', 'real_server');
        await processService.startServer(serverId, 'java -Xms1G -Xmx1G -jar server.jar nogui', serverDir);
        await wait(20000);

    }

    console.log('1. Connecting Client 1...');
    const client1 = io('http://127.0.0.1:3001');
    
    let c1History = '';
    let c1Lines = 0;
    
    client1.on('connect', () => {
        console.log('Client 1 Connected!');
        client1.emit('subscribe:server', serverId);
        client1.emit('subscribe:host');
    });

    client1.on('consoleHistory', (data) => {
        c1History = data.history;
        console.log('Client 1 received history. Length:', c1History.length);
    });

    client1.on('consoleLine', (data) => {
        c1Lines++;
        // console.log('C1 Line:', data.line);
    });

    let hostMetricsCount = 0;
    client1.on('hostMetrics', (data) => {
        hostMetricsCount++;
    });

    let serverMetricsCount = 0;
    client1.on('serverMetrics', (data) => {
        serverMetricsCount++;
    });

    await wait(3000);
    
    console.log('2. Sending a command from Client 1...');
    client1.emit('sendCommand', { serverId, command: 'say Phase 4 Test Broadcast' });
    
    await wait(3000);
    console.log(`Client 1 captured ${c1Lines} live lines since connect.`);
    console.log(`Host metrics received: ${hostMetricsCount}`);
    console.log(`Server metrics received: ${serverMetricsCount}`);
    
    console.log('3. Connecting Client 2 (Testing multi-client without duplication)...');
    const client2 = io('http://127.0.0.1:3001');
    
    let c2Lines = 0;
    client2.on('connect', () => {
        client2.emit('subscribe:server', serverId);
    });
    client2.on('consoleLine', () => c2Lines++);
    
    await wait(2000);
    
    console.log('Sending command from Client 1, both should receive it...');
    client1.emit('sendCommand', { serverId, command: 'say Phase 4 Multi-Client Test' });
    
    await wait(3000);
    
    console.log(`Client 2 captured ${c2Lines} live lines.`);
    
    if (c2Lines > c1Lines) {
        console.error('? Duplication detected! Client 2 got more live lines than the time it was connected.');
    } else {
        console.log('? No duplication detected.');
    }
    
    if (hostMetricsCount > 0) {
        console.log('? Host metrics are streaming.');
    } else {
        console.error('? Host metrics failed.');
    }

    client1.disconnect();
    client2.disconnect();
    
    console.log('--- PHASE 4 TESTS COMPLETE ---');
    process.exit(0);
}

runPhase4Test();
