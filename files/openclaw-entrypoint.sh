#!/bin/sh
# Wrapper entrypoint for openclaw-gateway.
# 1. Start the Manifest embedded server directly (gateway's registerService callback is never invoked).
# 2. Start the Manifest loopback relay (socat: 2100 → 2099).
# 3. Exec the original entrypoint.

MANIFEST_DB_DIR="${HOME}/.openclaw/manifest"
MANIFEST_PLUGIN="/home/node/.openclaw/extensions/manifest/dist/server.js"

mkdir -p "${MANIFEST_DB_DIR}"

# Start manifest server on port 2099 if the plugin is installed
if [ -f "${MANIFEST_PLUGIN}" ]; then
  node -e "
    const s = require('${MANIFEST_PLUGIN}');
    const dbPath = '${MANIFEST_DB_DIR}/manifest.db';
    s.start({ port: 2099, host: '0.0.0.0', dbPath: dbPath, quiet: true })
      .then(() => process.stdout.write('[entrypoint] Manifest server started on :2099\n'))
      .catch(e => process.stderr.write('[entrypoint] Manifest start failed: ' + e.message + '\n'));
  " &
  # Give manifest ~5s to bind before socat and gateway start
  sleep 5
fi

# Start socat relay: container port 2100 → manifest on 127.0.0.1:2099
pkill -f 'socat TCP-LISTEN:2100' 2>/dev/null || true
nohup socat TCP-LISTEN:2100,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:2099 </dev/null >/dev/null 2>&1 &

exec docker-entrypoint.sh "$@"
