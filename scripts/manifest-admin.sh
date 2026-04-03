#!/usr/bin/env bash
# manifest-admin
#
# Opens a temporary SSH tunnel to Manifest admin on openclaw-gateway,
# then launches the admin page in your browser automatically.
#
# Usage: manifest-admin

set -euo pipefail

REMOTE="eslick@speedracer.terrier-haddock.ts.net"
CONTAINER="openclaw-gateway"
HOST_PORT=2100      # intermediate port on speedracer host (127.0.0.1 only)
LOCAL_PORT=2099     # local port on this Mac
MANIFEST_PORT=2099  # port Manifest listens on inside the container
ADMIN_URL="http://localhost:${LOCAL_PORT}"

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

echo "Starting socat bridge on speedracer (127.0.0.1:${HOST_PORT} → ${CONTAINER_IP}:${MANIFEST_PORT})..."
ssh "$REMOTE" "nohup socat \
  TCP-LISTEN:${HOST_PORT},bind=127.0.0.1,reuseaddr,fork \
  TCP:${CONTAINER_IP}:${MANIFEST_PORT} \
  </dev/null >/tmp/manifest-socat.log 2>&1 &"

sleep 1

echo "Opening ${ADMIN_URL} ..."
open "$ADMIN_URL"

echo "Tunnel active. Press Ctrl-C to close."
ssh -N -L "${LOCAL_PORT}:127.0.0.1:${HOST_PORT}" "$REMOTE"
