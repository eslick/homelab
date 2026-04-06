# Google Workspace MCP Integration for OpenClaw

## Task

Integrate Gmail and Google Calendar into OpenClaw via the `mcp-google` npm package, registering two separate MCP server instances with scoped OAuth tokens.

## Playbook Used

`playbooks/docker.yml --tags openclaw`

Template changed: `templates/openclaw-Dockerfile.j2`

## What Was Done

1. **mcp-google** installed globally in the OpenClaw Docker image (`npm install -g mcp-google`).

2. Two MCP servers registered in `openclaw.json` via the playbook:
   - `google-workspace-vr` — Calendar + Contacts, token at `/secrets/google/token-vr.json`
   - `google-workspace-gmail` — Gmail, token at `/secrets/google/token-gmail.json`

3. **OAuth credentials** placed at `/opt/secrets/google/credentials.json` (OAuth Desktop app client from Google Cloud Console, project `august-sandbox-492203-t7`).

4. **Tokens** generated via one-time OAuth flow and stored at:
   - `/opt/secrets/google/token-vr.json`
   - `/opt/secrets/google/token-gmail.json`
   Both have `refresh_token` so they auto-refresh indefinitely.

5. **Bug fixed**: The Dockerfile's mcp-google patch used a non-greedy regex (`[\s\S]*?`) that stopped at the first `]` inside the `allOf` array, leaving orphaned JS syntax and causing a `SyntaxError` at Node.js v24 startup. Fixed by replacing the regex with a bracket-counting loop that finds the true closing `]` of the `allOf` array.

## Verification Steps

```bash
# Confirm mcp-google starts cleanly and refreshes tokens
docker exec openclaw-gateway bash -c "
  GOOGLE_OAUTH_CREDENTIALS=/secrets/google/credentials.json \
  GOOGLE_CALENDAR_MCP_TOKEN_PATH=/secrets/google/token-vr.json \
  timeout 5 mcp-google 2>&1
"
# Expected: "Token refreshed successfully" — no SyntaxError

# Confirm no MCP startup errors in logs
docker logs openclaw-gateway 2>&1 | grep "bundle-mcp"
# Expected: no "failed to start server" lines for google-workspace-*

# Confirm config
docker exec openclaw-gateway cat /home/node/.openclaw/openclaw.json | python3 -m json.tool | grep -A10 '"mcp"'
```

## Rollback

To remove Google Workspace MCP servers:

```bash
docker exec openclaw-gateway openclaw mcp remove google-workspace-vr
docker exec openclaw-gateway openclaw mcp remove google-workspace-gmail
```

To remove credentials:

```bash
sudo rm -rf /opt/secrets/google/
```

To revert the Dockerfile patch: remove the entire `node -e "..."` block from `templates/openclaw-Dockerfile.j2` and rebuild.
