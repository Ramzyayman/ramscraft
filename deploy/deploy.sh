#!/usr/bin/env bash
# Reproducible RamsCraft deploy. Uses SSH key auth (no passwords in this repo).
#
#   RAMSCRAFT_SSH=ramzy@192.168.1.6 ./deploy/deploy.sh
#
# Requires: SSH key access to the host, Node 20 installed there via nvm, and the
# ramscraft.service unit installed (see DEPLOYMENT.md).
set -euo pipefail

SSH_TARGET="${RAMSCRAFT_SSH:-ramzy@192.168.1.6}"
REMOTE_DIR="${RAMSCRAFT_REMOTE_DIR:-/home/ramzy/ramscraft}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Packing source"
TMP_TAR="$(mktemp)"
tar czf "$TMP_TAR" \
    --exclude 'node_modules' --exclude 'dist' --exclude '.git' \
    -C "$HERE" shared backend frontend package.json

echo "==> Uploading to $SSH_TARGET:$REMOTE_DIR"
ssh "$SSH_TARGET" "mkdir -p '$REMOTE_DIR'"
cat "$TMP_TAR" | ssh "$SSH_TARGET" "tar xzf - -C '$REMOTE_DIR'"
rm -f "$TMP_TAR"

echo "==> Building on host (Node 20 via nvm)"
ssh "$SSH_TARGET" "bash -lc '
    export NVM_DIR=\$HOME/.nvm; . \$NVM_DIR/nvm.sh; nvm use 20 >/dev/null
    cd $REMOTE_DIR/shared   && npm install --no-audit --no-fund && npm run build
    cd $REMOTE_DIR/backend  && npm install --no-audit --no-fund && npx prisma generate && npx tsc
    cd $REMOTE_DIR/frontend && npm install --no-audit --no-fund && npm run build
'"

echo "==> Restarting service"
if ssh "$SSH_TARGET" "systemctl list-unit-files | grep -q ramscraft.service"; then
    ssh "$SSH_TARGET" "sudo systemctl restart ramscraft"
else
    echo "!! ramscraft.service not installed; see DEPLOYMENT.md. Falling back to start.sh"
    ssh "$SSH_TARGET" "cd $REMOTE_DIR/backend && (tmux kill-session -t rc_backend 2>/dev/null || true) && bash start.sh"
fi
echo "==> Done"
