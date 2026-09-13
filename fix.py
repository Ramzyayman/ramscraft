import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.6', username='ramzy', password='Ramzy123', timeout=5)

commands = [
    "cd /home/ramzy/ramscraft/backend && npm install axios",
    "cd /home/ramzy/ramscraft/backend && pkill node; nohup node dist/index.js > backend.log 2>&1 &"
]

for cmd in commands:
    stdin, stdout, stderr = ssh.exec_command(cmd)
    stdout.channel.recv_exit_status()

ssh.close()
