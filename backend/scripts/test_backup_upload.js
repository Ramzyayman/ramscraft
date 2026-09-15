// Self-check for uploaded backups and software detection. Needs `unzip` and `tar` (the VM has both).
// Run from backend/ after `npm run build`: node scripts/test_backup_upload.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');

const up = require('../dist/services/backupUpload');
const { detectSoftware, setServerPort } = require('../dist/services/detectSoftware');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-upload-'));
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

// level.dat with Data.Version.Name (gzipped NBT)
function levelDat(version) {
    const str = s => { const b = Buffer.from(s); const len = Buffer.alloc(2); len.writeUInt16BE(b.length); return Buffer.concat([len, b]); };
    const tag = (type, name, payload) => Buffer.concat([Buffer.from([type]), str(name), payload]);
    const compound = (...children) => Buffer.concat([...children, Buffer.from([0])]);
    const root = tag(10, '', compound(tag(10, 'Data', compound(tag(10, 'Version', compound(tag(8, 'Name', str(version))))))));
    return zlib.gzipSync(root);
}
const jarWithVersion = version => { const z = new AdmZip(); z.addFile('version.json', Buffer.from(JSON.stringify({ id: version, name: version }))); return z.toBuffer(); };

async function uploadBuffer(serverId, backupDir, name, buffer, chunks = 3) {
    const u = up.startUpload(serverId, backupDir, name, buffer.length);
    const size = Math.ceil(buffer.length / chunks);
    for (let offset = 0; offset < buffer.length; offset += size) {
        await up.writeChunk(u, offset, Readable.from([buffer.subarray(offset, offset + size)]));
    }
    up.finishUpload(u);
    while (u.state === 'processing') await new Promise(r => setTimeout(r, 100));
    return u;
}

(async () => {
    // 1. Pure helpers
    assert.strictEqual(up.archiveKind('My Server.zip'), 'zip');
    assert.strictEqual(up.archiveKind('backup.TAR.GZ'), 'tar.gz');
    assert.strictEqual(up.archiveKind('server.rar'), null);
    for (const bad of ['/etc/passwd', '../x', 'a/../../x', 'C:\\Windows\\x', 'a\\..\\b']) assert.ok(up.unsafeEntry(bad), bad);
    for (const ok of ['server.properties', 'world/region/r.0.0.mca', 'My Server/plugins/x.jar', '..hidden/file']) assert.ok(!up.unsafeEntry(ok), ok);
    console.log('helpers ok');

    // 2. Chunk rules: in order only, never past the declared size, a failed chunk can be resent
    const backupDir = path.join(tmp, 'srv_backups');
    const u = up.startUpload('s1', backupDir, 'x.zip', 10);
    await assert.rejects(up.writeChunk(u, 5, Readable.from([Buffer.from('abc')])), e => e.status === 409);
    await assert.rejects(up.writeChunk(u, 0, Readable.from([Buffer.alloc(11)])), e => e.status === 413);
    assert.strictEqual(u.received, 0);
    await up.writeChunk(u, 0, Readable.from([Buffer.from('12345')]));
    await up.writeChunk(u, 5, Readable.from([Buffer.from('67890')]));
    assert.strictEqual(fs.readFileSync(u.file, 'utf8'), '1234567890');
    assert.throws(() => up.startUpload('s1', backupDir, 'x.exe', 10), e => e.status === 400);
    up.cancelUpload(u);
    assert.ok(!fs.existsSync(u.file) && !up.getUpload('s1', u.id));
    console.log('chunk rules ok');

    // 3. A zipped Paper server wrapped in "My Server/" (+ macOS junk) becomes a normal backup
    const zip = new AdmZip();
    zip.addFile('My Server/server.properties', Buffer.from('level-name=world\nserver-port=25565\nmotd=From my PC\n'));
    zip.addFile('My Server/paper-1.21.4-100.jar', jarWithVersion('1.21.4'));
    zip.addFile('My Server/config/paper-global.yml', Buffer.from('x: 1\n'));
    zip.addFile('My Server/version_history.json', Buffer.from('{"currentVersion":"git-Paper-100 (MC: 1.21.4)"}'));
    zip.addFile('My Server/world/level.dat', levelDat('1.21.3'));
    zip.addFile('__MACOSX/My Server/._server.properties', Buffer.from('junk'));
    const done = await uploadBuffer('s1', backupDir, 'My Server.zip', zip.toBuffer());
    assert.strictEqual(done.state, 'done', done.error);
    assert.match(done.backupName, /^upload_\d+_My-Server\.tar\.gz$/);
    const listing = execFileSync('tar', ['-tzf', path.join(backupDir, done.backupName)]).toString();
    assert.ok(listing.includes('./server.properties') && !listing.includes('My Server') && !listing.includes('__MACOSX'), listing);
    assert.deepStrictEqual(fs.readdirSync(backupDir).filter(n => n.startsWith('.')), [], 'temporary files cleaned up');
    console.log('zip upload -> backup ok');

    // 4. Detection on the restored files
    const restored = path.join(tmp, 'restored');
    fs.mkdirSync(restored);
    execFileSync('tar', ['-xzf', path.join(backupDir, done.backupName), '-C', restored]);
    assert.deepStrictEqual(detectSoftware(restored), { provider: 'paper', mcVersion: '1.21.4', releaseId: '100', launch: { jar: 'paper-1.21.4-100.jar' } });
    setServerPort(restored, 25790);
    assert.strictEqual(fs.readFileSync(path.join(restored, 'server.properties'), 'utf8'), 'level-name=world\nserver-port=25790\nmotd=From my PC\n');
    console.log('paper detection + port ok');

    // 5. Refusals: not a server folder, not a zip
    const worldOnly = new AdmZip();
    worldOnly.addFile('world/level.dat', levelDat('1.21.4'));
    const refused = await uploadBuffer('s1', backupDir, 'world.zip', worldOnly.toBuffer());
    assert.strictEqual(refused.state, 'error');
    assert.match(refused.error, /doesn't look like a Minecraft server folder/);
    const garbage = await uploadBuffer('s1', backupDir, 'broken.zip', Buffer.from('definitely not a zip'), 1);
    assert.strictEqual(garbage.state, 'error');
    assert.match(garbage.error, /not a readable \.zip/);
    console.log('refusals ok');

    // 6. .tar.gz upload with a wrapper folder
    const tarSrc = path.join(tmp, 'tarsrc', 'Wrapped');
    w(path.join(tarSrc, 'server.properties'), 'server-port=25565\n');
    fs.writeFileSync(path.join(tarSrc, 'server.jar'), jarWithVersion('26.3-rc-3'));
    execFileSync('tar', ['-czf', path.join(tmp, 'wrapped.tar.gz'), '-C', path.join(tmp, 'tarsrc'), 'Wrapped']);
    const tarDone = await uploadBuffer('s1', backupDir, 'wrapped.tar.gz', fs.readFileSync(path.join(tmp, 'wrapped.tar.gz')));
    assert.strictEqual(tarDone.state, 'done', tarDone.error);
    const tarRestored = path.join(tmp, 'tar-restored');
    fs.mkdirSync(tarRestored);
    execFileSync('tar', ['-xzf', path.join(backupDir, tarDone.backupName), '-C', tarRestored]);
    assert.deepStrictEqual(detectSoftware(tarRestored), { provider: 'snapshot', mcVersion: '26.3-rc-3', releaseId: '26.3-rc-3', launch: { jar: 'server.jar' } });
    console.log('tar.gz upload + snapshot detection ok');

    // 7. Other software layouts
    const layout = (name, files) => {
        const dir = path.join(tmp, 'layouts', name);
        for (const [p, content] of Object.entries(files)) w(path.join(dir, p), content);
        return detectSoftware(dir);
    };
    assert.deepStrictEqual(layout('neoforge', { 'libraries/net/neoforged/neoforge/21.1.77/unix_args.txt': '-x', 'libraries/net/neoforged/neoforge/21.1.50/unix_args.txt': '-x', 'run.sh': '' }),
        { provider: 'neoforge', mcVersion: '1.21.1', releaseId: '21.1.77', launch: { argsFile: 'libraries/net/neoforged/neoforge/21.1.77/unix_args.txt' } });
    assert.deepStrictEqual(layout('forge', { 'libraries/net/minecraftforge/forge/1.20.1-47.2.0/unix_args.txt': '-x', 'forge-1.20.1-47.2.0-installer.jar': '' }),
        { provider: 'forge', mcVersion: '1.20.1', releaseId: '1.20.1-47.2.0', launch: { argsFile: 'libraries/net/minecraftforge/forge/1.20.1-47.2.0/unix_args.txt' } });
    assert.deepStrictEqual(layout('forge-legacy', { 'forge-1.12.2-14.23.5.2860.jar': '', 'minecraft_server.1.12.2.jar': '' }),
        { provider: 'forge', mcVersion: '1.12.2', releaseId: '1.12.2-14.23.5.2860', launch: { jar: 'forge-1.12.2-14.23.5.2860.jar' } });
    assert.deepStrictEqual(layout('fabric', { 'fabric-server-launch.jar': '', 'server.jar': jarWithVersion('1.21.4'), 'libraries/net/fabricmc/fabric-loader/0.16.9/x.jar': '' }),
        { provider: 'fabric', mcVersion: '1.21.4', releaseId: '0.16.9', launch: { jar: 'fabric-server-launch.jar' } });
    assert.deepStrictEqual(layout('fabric-single', { 'fabric-server-mc.1.21.4-loader.0.16.9-launcher.1.0.1.jar': '' }),
        { provider: 'fabric', mcVersion: '1.21.4', releaseId: '0.16.9', launch: { jar: 'fabric-server-mc.1.21.4-loader.0.16.9-launcher.1.0.1.jar' } });
    assert.deepStrictEqual(layout('purpur', { 'purpur.yml': '', 'config/paper-global.yml': '', 'spigot.yml': '', 'purpur-1.21.4-2388.jar': jarWithVersion('1.21.4') }),
        { provider: 'purpur', mcVersion: '1.21.4', releaseId: 'unknown', launch: { jar: 'purpur-1.21.4-2388.jar' } });
    assert.deepStrictEqual(layout('vanilla-world-only-version', { 'server.jar': 'not a zip', 'server.properties': 'level-name=survival\n', 'survival/level.dat': levelDat('1.20.4') }),
        { provider: 'vanilla', mcVersion: '1.20.4', releaseId: '1.20.4', launch: { jar: 'server.jar' } });
    assert.strictEqual(layout('nothing', { 'server.properties': '', 'world/level.dat': levelDat('1.21') }), null);
    console.log('forge, neoforge, fabric, purpur, vanilla detection ok');

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('all backup upload checks passed');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
