#!/usr/bin/env bash
# manifest-admin
#
# SSH tunnel to Manifest admin on openclaw-gateway.
# socat runs inside the container on port 2100, relaying to Manifest's loopback
# 127.0.0.1:2099 — so Manifest sees the connection as loopback (auto-login works).
#
# Usage: manifest-admin

set -euo pipefail

REMOTE="eslick@speedracer.terrier-haddock.ts.net"
CONTAINER="openclaw-gateway"
LOCAL_PORT=2099
ADMIN_URL="http://127.0.0.1:${LOCAL_PORT}"

cleanup() {
  echo ""
  echo "Closing tunnel."
}
trap cleanup EXIT INT TERM

# Ensure socat relay is running inside the container
ssh "$REMOTE" "docker exec ${CONTAINER} pgrep -f 'socat TCP-LISTEN:2100' > /dev/null 2>&1 || \
  docker exec -d ${CONTAINER} socat TCP-LISTEN:2100,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:2099"

sleep 1

echo "Opening ${ADMIN_URL} ..."
open "$ADMIN_URL"

echo "Tunnel active. Press Ctrl-C to close."
ssh -N -L "${LOCAL_PORT}:127.0.0.1:2100" "$REMOTE"
