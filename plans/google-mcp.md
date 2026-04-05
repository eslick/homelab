[O---

Goal: Add Google Workspace (Gmail + Calendar) to OpenClaw via the mcp-google npm package.

---

Extend the Docker image


Create docker/openclaw/Dockerfile in the homelab repo:
FROM ghcr.io/openclaw/openclaw:latest
RUN npm install -g mcp-google


Update openclaw-compose.yml.j2 to build from this Dockerfile instead of pulling the image directly:
build:
  context: ../../docker/openclaw
  dockerfile: Dockerfile

(adjust path relative to where the compose file renders)

---

Add a Google auth directory to the vault mount


On speedracer, create a subdirectory inside the vault path:
{{ vault_path }}/google/


This is where credentials.json (OAuth client secret) and token.json (auto-refreshed access token) will live. The vault bind mount already covers this — no new mounts needed.
---

Add post-start config task for MCP registration


In playbooks/docker.yml, alongside the existing openclaw config set post-start tasks, add:

- name: Register google-workspace MCP server
  community.docker.docker_container_exec:
    container: openclaw-gateway
    command: >
      node dist/index.js mcp set google-workspace
      '{"command":"mcp-google","env":{
        "GOOGLE_OAUTH_CREDENTIALS":"/vault/google/credentials.json",
        "GOOGLE_CALENDAR_MCP_TOKEN_PATH":"/vault/google/token.json"
      }}'
---

One-time OAuth flow (manual step — Ian does this)


Before or after the rebuild, Ian will:
Copy credentials.json from Google Cloud Console to {{ vault_path }}/google/credentials.json on speedracer
Run the auth flow once to generate the token:
GOOGLE_OAUTH_CREDENTIALS={{ vault_path }}/google/credentials.json \
GOOGLE_CALENDAR_MCP_TOKEN_PATH={{ vault_path }}/google/token.json \
npx -y mcp-google

(This needs Node on speedracer's host, or can be done from Ian's MacBook with the vault path accessible. A browser will open for OAuth.)

After auth completes, token.json is written. From then on it auto-refreshes.

---
Rebuild and redeploy


Run the docker playbook to rebuild the image and restart the stack:
ansible-playbook playbooks/docker.yml --tags openclaw

(or whatever the appropriate tag/limit is)

---

Open questions for homelab to resolve:
What is the resolved value of {{ vault_path }}? (Needed to know where to put credentials.json)
Is mcp-google the right command name after npm install -g? (Confirm with which mcp-google inside container after build — may need full path)
What's the correct docker_container_exec or equivalent pattern used in the existing post-start tasks? (Match that style)
