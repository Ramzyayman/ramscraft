import paramiko
import sys
import os

try:
    print("Connecting to 192.168.1.6...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect('192.168.1.6', username='ramzy', password='Ramzy123', timeout=5)
    print("Connected!")
    
    # Upload file
    print("Uploading ramscraft.tar.gz...")
    sftp = ssh.open_sftp()
    sftp.put('ramscraft.tar.gz', '/home/ramzy/ramscraft.tar.gz')
    sftp.close()
    
    commands = [
        "cd /home/ramzy && rm -rf ramscraft && mkdir ramscraft && tar -xzf ramscraft.tar.gz -C ramscraft",
        "cd /home/ramzy/ramscraft/shared && npm i && npm run build",
        "cd /home/ramzy/ramscraft/backend && npm i && npx prisma db push && npm run build",
        "cd /home/ramzy/ramscraft/frontend && npm i && npm run build",
        "pm2 restart ramscraft-backend || pm2 start /home/ramzy/ramscraft/backend/dist/index.js --name ramscraft-backend"
    ]
    
    for cmd in commands:
        print(f"Executing: {cmd}")
        stdin, stdout, stderr = ssh.exec_command(cmd)
        exit_status = stdout.channel.recv_exit_status()
        print(stdout.read().decode())
        err = stderr.read().decode()
        if err:
            print(f"Error: {err}")
        if exit_status != 0:
            print(f"Command failed with exit status {exit_status}")
            
    ssh.close()
    print("Deployment finished successfully!")
except Exception as e:
    print(f"Deployment failed: {e}")
    sys.exit(1)
