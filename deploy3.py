import paramiko
import sys

try:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect('192.168.1.6', username='ramzy', password='Ramzy123', timeout=5)
    
    commands = [
        "cd /home/ramzy/ramscraft/backend && npm i && npx prisma db push && npm run build",
        "cd /home/ramzy/ramscraft/frontend && npm i && npm run build",
        "export PATH=$PATH:/usr/local/bin:/home/ramzy/.nvm/versions/node/v18.19.1/bin && pm2 restart ramscraft-backend || pm2 start /home/ramzy/ramscraft/backend/dist/index.js --name ramscraft-backend"
    ]
    
    for cmd in commands:
        stdin, stdout, stderr = ssh.exec_command(cmd)
        exit_status = stdout.channel.recv_exit_status()
        print(f"--- CMD: {cmd} ---")
        print(stdout.read().decode(errors='replace'))
        print(stderr.read().decode(errors='replace'))
            
    ssh.close()
except Exception as e:
    sys.exit(1)
