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

# Patch manifest plugin: increase provider HTTP timeout from 180s to 300s.
# Reasoning models (Kimi-K2.5) can think for >3 minutes before first token.
if [ -f "${PROVIDER_CLIENT}" ] && grep -q "PROVIDER_TIMEOUT_MS = 180_000" "${PROVIDER_CLIENT}"; then
  sed -i 's/PROVIDER_TIMEOUT_MS = 180_000/PROVIDER_TIMEOUT_MS = 300_000/' "${PROVIDER_CLIENT}"
  echo "[entrypoint] Patched manifest PROVIDER_TIMEOUT_MS 180s -> 300s"
fi

# Patch manifest plugin: cap max_tokens to 2048 for custom (vLLM) providers.
# vLLM has a 32k context limit; with large prompts (28k+) a 4096 max_tokens
# request overflows. Cap it so prompt + output can never exceed the limit.
if [ -f "${PROVIDER_CLIENT}" ] && ! grep -q "VLLM_MAX_OUTPUT_TOKENS" "${PROVIDER_CLIENT}"; then
  node -e "
    const fs = require('fs');
    let src = fs.readFileSync('${PROVIDER_CLIENT}', 'utf8');
    const old = \"requestBody = { ...sanitized, model: bareModel, stream };\";
    const fix = \"requestBody = { ...sanitized, model: bareModel, stream };\\n            if (endpointKey === 'custom' && requestBody.max_tokens > 2048) { /* VLLM_MAX_OUTPUT_TOKENS */ requestBody.max_tokens = 2048; }\"
    if (src.includes(old)) {
      fs.writeFileSync('${PROVIDER_CLIENT}', src.replace(old, fix));
      process.stdout.write('[entrypoint] Patched manifest custom provider max_tokens cap (2048)\\n');
    }
  " 2>/dev/null || true
fi

# Patch proxy-response-handler: strip reasoning_content from custom provider (Together AI) responses.
# DeepSeek-V3.1 on Together returns chain-of-thought in reasoning_content; the custom-provider path
# has no transform so it leaks verbatim into Telegram/Discord chats.
# Fix: add a transform to the streaming path and strip from non-streaming response body.
RESPONSE_HANDLER="/home/node/.openclaw/extensions/manifest/dist/backend/routing/proxy/proxy-response-handler.js"
if [ -f "${RESPONSE_HANDLER}" ] && ! grep -q "STRIP_REASONING_CONTENT" "${RESPONSE_HANDLER}"; then
  node -e "
    const fs = require('fs');
    let src = fs.readFileSync('${RESPONSE_HANDLER}', 'utf8');

    // Streaming: add transform to strip reasoning_content from SSE chunks
    const oldStream = 'return (0, stream_writer_1.pipeStream)(forward.response.body, res);';
    const newStream = 'return (0, stream_writer_1.pipeStream)(forward.response.body, res, (chunk) => { /* STRIP_REASONING_CONTENT */ try { const obj = JSON.parse(chunk); if (obj && obj.choices) { for (const c of obj.choices) { if (c.delta && \\'reasoning_content\\' in c.delta) delete c.delta.reasoning_content; } } return \\'data: \\' + JSON.stringify(obj) + String.fromCharCode(10, 10); } catch { return \\'data: \\' + chunk + String.fromCharCode(10, 10); } });';

    // Non-streaming: strip reasoning_content after json() parse
    const oldNonStream = 'responseBody = await forward.response.json();';
    const newNonStream = 'responseBody = await forward.response.json(); /* STRIP_REASONING_CONTENT */ if (responseBody && responseBody.choices) { for (const c of responseBody.choices) { if (c.message && \\'reasoning_content\\' in c.message) delete c.message.reasoning_content; } }';

    let patched = src;
    if (src.includes(oldStream)) {
      patched = patched.replace(oldStream, newStream);
      process.stdout.write('[entrypoint] Patched proxy-response-handler: stream reasoning_content strip\\n');
    } else {
      process.stdout.write('[entrypoint] WARN: stream patch target not found in proxy-response-handler\\n');
    }
    if (patched.includes(oldNonStream)) {
      patched = patched.replace(oldNonStream, newNonStream);
      process.stdout.write('[entrypoint] Patched proxy-response-handler: non-stream reasoning_content strip\\n');
    } else {
      process.stdout.write('[entrypoint] WARN: non-stream patch target not found in proxy-response-handler\\n');
    }
    fs.writeFileSync('${RESPONSE_HANDLER}', patched);
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

  # Re-seed Manifest provider/tier config (cached_models cleared on every restart by discovery service)
  for SETUP_SCRIPT in "${HOME}/.openclaw/manifest-setup.sh" "${HOME}/.openclaw/manifest-together-setup.sh"; do
    if [ -f "${SETUP_SCRIPT}" ]; then
      LABEL=$(basename "${SETUP_SCRIPT}" .sh)
      sh "${SETUP_SCRIPT}" 2>&1 | sed "s/^/[entrypoint] ${LABEL}: /" || true
    fi
  done
fi

# Start socat relay: container port 2100 → manifest on 127.0.0.1:2099
pkill -f 'socat TCP-LISTEN:2100' 2>/dev/null || true
nohup socat TCP-LISTEN:2100,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:2099 </dev/null >/dev/null 2>&1 &

exec docker-entrypoint.sh "$@"
