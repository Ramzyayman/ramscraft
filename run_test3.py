import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.1.6', username='ramzy', password='Ramzy123', timeout=5)
stdin, stdout, stderr = ssh.exec_command("mv /home/ramzy/test.mjs /home/ramzy/ramscraft/backend/test.mjs && cd /home/ramzy/ramscraft/backend && node test.mjs")
print(stdout.read().decode())
err = stderr.read().decode()
if err: print("STDERR:", err)
ssh.close()
