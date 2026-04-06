#!/bin/sh
# Wrapper entrypoint for openclaw-gateway.
# 1. Start the Manifest embedded server directly (gateway's registerService callback is never invoked).
# 2. Start the Manifest loopback relay (socat: 2100 → 2099).
# 3. Exec the original entrypoint.

MANIFEST_DB_DIR="${HOME}/.openclaw/manifest"
MANIFEST_PLUGIN="/home/node/.openclaw/extensions/manifest/dist/server.js"

mkdir -p "${MANIFEST_DB_DIR}"

# Patch manifest plugin: fix double-stripping of custom provider model names with slashes
# Bug: rawModelName() strips 'custom:UUID/' leaving 'provider/model', then stripModelPrefix()
# strips 'provider/' again leaving just 'model'. Fix: make stripModelPrefix a no-op for 'custom'.
PROVIDER_CLIENT="/home/node/.openclaw/extensions/manifest/dist/backend/routing/proxy/provider-client.js"
if [ -f "${PROVIDER_CLIENT}" ] && ! grep -q "endpointKey === 'custom'" "${PROVIDER_CLIENT}"; then
  node -e "
    const fs = require('fs');
    let src = fs.readFileSync('${PROVIDER_CLIENT}', 'utf8');
    const old = \"if (endpointKey === 'openrouter')\\n        return model;\\n    const slashIdx\";
    const fix = \"if (endpointKey === 'openrouter')\\n        return model;\\n    if (endpointKey === 'custom')\\n        return model;\\n    const slashIdx\";
    if (src.includes(old)) {
      fs.writeFileSync('${PROVIDER_CLIENT}', src.replace(old, fix));
      process.stdout.write('[entrypoint] Patched manifest stripModelPrefix (custom provider double-strip fix)\\n');
    }
  " 2>/dev/null || true
fi

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
