import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.6', username='ramzy', password='Ramzy123', timeout=5)

sftp = ssh.open_sftp()
sftp.put(r"C:\Users\PC\.gemini\antigravity\scratch\ramscraft\backend\src\services\WebSocketService.ts", "/home/ramzy/ramscraft/backend/src/services/WebSocketService.ts")
sftp.close()

stdin, stdout, stderr = ssh.exec_command("cd /home/ramzy/ramscraft/backend && npx tsc")
print("TSC:", stdout.read().decode('utf-8', errors='ignore'))
print("TSC ERR:", stderr.read().decode('utf-8', errors='ignore'))

stdin, stdout, stderr = ssh.exec_command("cd /home/ramzy/ramscraft/backend && tmux kill-session -t backend_server; tmux new-session -d -s backend_server 'node dist/index.js >> backend.log 2>&1'")
ssh.close()
print("Deployed WebSocketService.")
