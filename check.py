import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.6', username='ramzy', password='Ramzy123', timeout=5)
stdin, stdout, stderr = ssh.exec_command("tail -n 20 /home/ramzy/ramscraft/backend/backend.log")
print(stdout.read().decode())
ssh.close()
