import paramiko
import os

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.6', username='ramzy', password='Ramzy123', timeout=5)

sftp = ssh.open_sftp()
local_dir = r"C:\Users\PC\.gemini\antigravity\scratch\ramscraft\frontend\dist"
remote_dir = "/home/ramzy/ramscraft/frontend/dist"

def sftp_put_dir(local_dir, remote_dir):
    try:
        sftp.mkdir(remote_dir)
    except:
        pass
    for root, dirs, files in os.walk(local_dir):
        for name in dirs:
            remote_path = os.path.join(remote_dir, os.path.relpath(os.path.join(root, name), local_dir)).replace("\\", "/")
            try:
                sftp.mkdir(remote_path)
            except:
                pass
        for name in files:
            local_path = os.path.join(root, name)
            remote_path = os.path.join(remote_dir, os.path.relpath(local_path, local_dir)).replace("\\", "/")
            sftp.put(local_path, remote_path)

sftp_put_dir(local_dir, remote_dir)

# Put backend files
sftp.put(r"C:\Users\PC\.gemini\antigravity\scratch\ramscraft\backend\package.json", "/home/ramzy/ramscraft/backend/package.json")
sftp.put(r"C:\Users\PC\.gemini\antigravity\scratch\ramscraft\backend\package-lock.json", "/home/ramzy/ramscraft/backend/package-lock.json")
sftp.put(r"C:\Users\PC\.gemini\antigravity\scratch\ramscraft\backend\src\services\WebSocketService.ts", "/home/ramzy/ramscraft/backend/src/services/WebSocketService.ts")

sftp.close()

stdin, stdout, stderr = ssh.exec_command("cd /home/ramzy/ramscraft/backend && npm install")
print(stdout.read().decode('utf-8', errors='ignore'))
print(stderr.read().decode('utf-8', errors='ignore'))

stdin, stdout, stderr = ssh.exec_command("cd /home/ramzy/ramscraft/backend && npx tsc")
print("TSC:", stdout.read().decode('utf-8', errors='ignore'))

stdin, stdout, stderr = ssh.exec_command("cd /home/ramzy/ramscraft/backend && tmux kill-session -t backend_server; tmux new-session -d -s backend_server 'node dist/index.js >> backend.log 2>&1'")

ssh.close()
print("Deployed backend and frontend.")
