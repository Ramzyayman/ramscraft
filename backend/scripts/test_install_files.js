// Self-check for installFiles (the merge step of Change Software).
// Run from backend/ after `npm run build`: node scripts/test_install_files.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { installFiles } = require('../dist/services/installFiles');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-install-'));
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const r = p => fs.readFileSync(p, 'utf8');

function fixture(name) {
    const server = path.join(tmp, name, 'server');
    const staging = path.join(tmp, name, 'staging');
    w(path.join(server, 'server.properties'), 'level-name=myworld\nmotd=keep me\n');
    w(path.join(server, 'myworld', 'level.dat'), 'WORLD');
    w(path.join(server, 'ops.json'), '[ops]');
    w(path.join(server, 'server.jar'), 'OLD JAR');
    w(path.join(server, 'libraries', 'old', 'lib.jar'), 'OLD LIB');
    w(path.join(server, 'config', 'user.toml'), 'user setting');
    w(path.join(server, 'config', 'shared.toml'), 'old shared');
    w(path.join(staging, 'server.jar'), 'NEW JAR');
    w(path.join(staging, 'libraries', 'new', 'lib.jar'), 'NEW LIB');
    w(path.join(staging, 'config', 'shared.toml'), 'new shared');
    w(path.join(staging, 'server.properties'), 'motd=from the pack\n');
    w(path.join(staging, 'myworld', 'level.dat'), 'PACK WORLD');
    return { server, staging };
}

// 1. Successful merge
{
    const { server, staging } = fixture('ok');
    installFiles(staging, server, { files: ['server.jar', 'libraries', 'config', 'server.properties', 'myworld'] });
    assert.strictEqual(r(path.join(server, 'server.jar')), 'NEW JAR');
    assert.ok(!fs.existsSync(path.join(server, 'libraries', 'old')), 'libraries replaced wholesale');
    assert.strictEqual(r(path.join(server, 'libraries', 'new', 'lib.jar')), 'NEW LIB');
    assert.strictEqual(r(path.join(server, 'config', 'user.toml')), 'user setting', 'config merged, user file kept');
    assert.strictEqual(r(path.join(server, 'config', 'shared.toml')), 'new shared');
    assert.strictEqual(r(path.join(server, 'server.properties')), 'level-name=myworld\nmotd=keep me\n', 'server.properties never overwritten');
    assert.strictEqual(r(path.join(server, 'myworld', 'level.dat')), 'WORLD', 'world never overwritten');
    assert.strictEqual(r(path.join(server, 'ops.json')), '[ops]');
    assert.strictEqual(r(path.join(server, '.ramscraft', 'replaced', 'server.jar')), 'OLD JAR', 'replaced jar kept');
    assert.strictEqual(r(path.join(server, '.ramscraft', 'replaced', 'config', 'shared.toml')), 'old shared');
    console.log('merge ok');
}

// 2. Failure midway rolls everything back
{
    const { server, staging } = fixture('rollback');
    assert.throws(() => installFiles(staging, server, { files: ['server.jar', 'libraries', 'missing-file'] }), /did not produce missing-file/);
    assert.strictEqual(r(path.join(server, 'server.jar')), 'OLD JAR', 'jar restored');
    assert.strictEqual(r(path.join(server, 'libraries', 'old', 'lib.jar')), 'OLD LIB', 'libraries restored');
    assert.ok(!fs.existsSync(path.join(server, 'libraries', 'new')));
    assert.strictEqual(r(path.join(staging, 'server.jar')), 'NEW JAR', 'staged files moved back');
    console.log('rollback ok');
}

// 3. Unsafe names are refused
{
    const { server, staging } = fixture('unsafe');
    assert.throws(() => installFiles(staging, server, { files: ['../escape'] }), /Invalid installed file name/);
    console.log('unsafe names ok');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('all installFiles checks passed');
process.exit(0);
