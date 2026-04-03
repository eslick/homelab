#!/usr/bin/env bash
# manifest-tunnel.sh
#
# Opens a temporary SSH tunnel to Manifest admin (port 2099) on openclaw-gateway.
# Manifest listens on 0.0.0.0 inside the container, so we run socat on the
# speedracer HOST to bridge host:2100 → container-bridge-IP:2099, then SSH-tunnel
# Mac:2099 → speedracer:2100.
#
# Usage (run from your Mac):
#   ./manifest-tunnel.sh
#
# Then open: http://localhost:2099
# Ctrl-C to tear everything down.

set -euo pipefail

REMOTE="eslick@speedracer.terrier-haddock.ts.net"
CONTAINER="openclaw-gateway"
HOST_PORT=2100      # intermediate port on speedracer host (127.0.0.1 only)
LOCAL_PORT=2099     # port you'll browse to on your Mac
MANIFEST_PORT=2099  # port Manifest listens on inside the container

cleanup() {
  echo ""
  echo "Tearing down socat on speedracer..."
  ssh "$REMOTE" "pkill -f 'socat TCP-LISTEN:${HOST_PORT}' 2>/dev/null || true"
  echo "Done."
}
trap cleanup EXIT INT TERM

echo "Resolving container bridge IP for ${CONTAINER}..."
CONTAINER_IP=$(ssh "$REMOTE" \
  "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${CONTAINER}")

if [[ -z "$CONTAINER_IP" ]]; then
  echo "ERROR: could not resolve container IP for ${CONTAINER}" >&2
  exit 1
fi
echo "  Container IP: ${CONTAINER_IP}"

echo "Starting socat on speedracer host (127.0.0.1:${HOST_PORT} → ${CONTAINER_IP}:${MANIFEST_PORT})..."
ssh "$REMOTE" "nohup socat \
  TCP-LISTEN:${HOST_PORT},bind=127.0.0.1,reuseaddr,fork \
  TCP:${CONTAINER_IP}:${MANIFEST_PORT} \
  </dev/null >/tmp/manifest-socat.log 2>&1 &"

# Give socat a moment to start
sleep 1

echo "Tunnel open: localhost:${LOCAL_PORT} → speedracer:${HOST_PORT} → ${CONTAINER_IP}:${MANIFEST_PORT}"
echo "Open: http://localhost:${LOCAL_PORT}"
echo "Press Ctrl-C to close."

# Block until Ctrl-C; -N = no command, just forward
ssh -N -L "${LOCAL_PORT}:127.0.0.1:${HOST_PORT}" "$REMOTE"
