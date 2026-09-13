import paramiko

with open("deploy.log", "w", encoding="utf-8") as f:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect('192.168.1.6', username='ramzy', password='Ramzy123', timeout=5)
    
    # Upload file
    print("Uploading ramscraft.tar.gz...")
    sftp = ssh.open_sftp()
    sftp.put('ramscraft.tar.gz', '/home/ramzy/ramscraft.tar.gz')
    sftp.close()
    
    commands = [
        "cd /home/ramzy && rm -rf ramscraft && mkdir ramscraft && tar -xzf ramscraft.tar.gz -C ramscraft",
        "cd /home/ramzy/ramscraft/shared && npm i",
        "cd /home/ramzy/ramscraft/backend && npm i && npx prisma db push",
        "cd /home/ramzy/ramscraft/backend && pkill node; nohup node dist/index.js > backend.log 2>&1 &"
    ]
    
    for cmd in commands:
        f.write(f"--- CMD: {cmd} ---\n")
        stdin, stdout, stderr = ssh.exec_command(cmd)
        exit_status = stdout.channel.recv_exit_status()
        f.write(stdout.read().decode(errors='replace') + "\n")
        f.write(stderr.read().decode(errors='replace') + "\n")
            
    ssh.close()
