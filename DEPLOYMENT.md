# RamsCraft Deployment

## Requirements
- **Node.js 20+** (the frontend build tool, Vite/rolldown, requires Node ≥ 20.19).
  Installed on the host via nvm:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  source ~/.nvm/nvm.sh && nvm install 20 && nvm alias default 20
  ```
- **tmux**, a JDK (Java 21 and/or 25 for current Minecraft), and SSH key access.

## Exposure model (security)
RamsCraft binds to **127.0.0.1 only** by default and expects to run behind the
existing RamsesHub/nginx reverse proxy, which authenticates users and proxies to
`127.0.0.1:3001` (loopback is trusted). This keeps the management API — which
controls OS processes and files — off the open network.

To expose it directly on the LAN instead, set both in `backend/.env`:
```
RAMSCRAFT_HOST=0.0.0.0
RAMSCRAFT_API_TOKEN=<long random secret>
```
The backend refuses to bind to a public interface without a token. Clients supply
the token via `?token=` once (stored in the browser) or the on-screen prompt.

Copy `.env.example` to `backend/.env` and edit.

## First-time service install
```bash
sudo cp deploy/ramscraft.service /etc/systemd/system/ramscraft.service
# Adjust ExecStart to the actual Node 20 path: nvm which 20
sudo systemctl daemon-reload
sudo systemctl enable --now ramscraft
```
This replaces the old `nohup start.sh` approach and restarts the panel on crash
and on boot.

## Deploying updates
```bash
RAMSCRAFT_SSH=ramzy@192.168.1.6 ./deploy/deploy.sh
```
The script uploads the source, builds `shared`, `backend`, and `frontend` on the
host with Node 20, and restarts the service.

## Notes
- Never commit secrets. `backend/.env` is git-ignored.
- The old `deploy_*.py` scripts (which embedded the SSH password) were removed;
  use key-based SSH.
