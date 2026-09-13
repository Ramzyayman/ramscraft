const fs = require('fs');
const path = require('path');

function processDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            processDir(fullPath);
        } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('http://192.168.1.6:3001')) {
                // For socket.io: io('http://192.168.1.6:3001' -> io()
                content = content.replace(/io\('http:\/\/192\.168\.1\.6:3001'/g, "io()");
                content = content.replace(/io\("http:\/\/192\.168\.1\.6:3001"/g, "io()");
                content = content.replace(/io\(`http:\/\/192\.168\.1\.6:3001`/g, "io()");
                // For axios: `http://192.168.1.6:3001/api/...` -> `/api/...`
                content = content.replace(/http:\/\/192\.168\.1\.6:3001/g, "");
                fs.writeFileSync(fullPath, content, 'utf8');
            }
        }
    }
}
processDir(path.join(__dirname, 'src'));
