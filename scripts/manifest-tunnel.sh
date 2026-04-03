#!/usr/bin/env bash
# manifest-tunnel.sh
#
# Opens a temporary SSH tunnel to Manifest admin (port 2099) on openclaw-gateway.
# Manifest only trusts 127.0.0.1, so we use socat inside the container to bridge
# the host-side tunnel endpoint to the container's loopback.
#
# Usage (run from your Mac):
#   ./manifest-tunnel.sh
#
# Then open: http://localhost:2099
# Ctrl-C to tear everything down.

set -euo pipefail

REMOTE="eslick@speedracer.terrier-haddock.ts.net"
CONTAINER="openclaw-gateway"
HOST_PORT=2100   # intermediate port on speedracer host (127.0.0.1 only)
LOCAL_PORT=2099  # port you'll browse to on your Mac
MANIFEST_PORT=2099  # port Manifest listens on inside the container

cleanup() {
  echo ""
  echo "Tearing down socat on speedracer..."
  ssh "$REMOTE" "pkill -f 'socat TCP-LISTEN:${HOST_PORT}' 2>/dev/null || true"
  echo "Done."
}
trap cleanup EXIT INT TERM

echo "Starting socat bridge inside ${CONTAINER} (container:${MANIFEST_PORT} → host:${HOST_PORT})..."
ssh "$REMOTE" "
  docker exec -d ${CONTAINER} socat \
    TCP-LISTEN:${HOST_PORT},bind=127.0.0.1,reuseaddr,fork \
    TCP:127.0.0.1:${MANIFEST_PORT}
"

# Give socat a moment to start
sleep 1

echo "Tunnel open: localhost:${LOCAL_PORT} → speedracer:${HOST_PORT} → ${CONTAINER}:${MANIFEST_PORT}"
echo "Open: http://localhost:${LOCAL_PORT}"
echo "Press Ctrl-C to close."

# Block until Ctrl-C; -N = no command, just forward
ssh -N -L "${LOCAL_PORT}:127.0.0.1:${HOST_PORT}" "$REMOTE"
