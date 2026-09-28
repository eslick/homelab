# Runbook: homedev Clojure AI Orchestrator Setup

**Date:** 2026-09-27  
**Author:** Ian Eslick

## Task

Set up the homedev Clojure development environment: a Docker JVM container with
nREPL on :7888, hot-reload via clj-reload + beholder, and connections to all
homelab services (CockroachDB, MinIO, Home Assistant, vLLM). Includes a GitHub
repo, clojure-mcp integration with Claude Code, and a Tailscale-accessible web
UI port.

## Playbooks Used

- `playbooks/system.yml --tags java,clojure` — install OpenJDK 21 and Clojure CLI
- `playbooks/docker.yml --tags homedev` — create compose dir, build image, start
  container, create CRDB `homedev` database, create MinIO `homedev` bucket
- `playbooks/nginx.yml --tags homedev,security` — proxy :3000→:3001 via Tailscale TLS

## New Files

**homelab repo:**
- `templates/homedev-compose.yml.j2` — Docker Compose template (host networking)
- `templates/homedev-nginx.conf.j2` — nginx reverse proxy with WS upgrade headers
- `playbooks/system.yml` — added OpenJDK 21 JRE and Clojure CLI install tasks
- `playbooks/docker.yml` — added homedev to services list + build/DB/bucket tasks
- `playbooks/nginx.yml` — added homedev vars, tailscale_services entry, UFW rules
- `group_vars/all.yml` — added vault_minio_root_user, vault_minio_root_password,
  vault_ha_token (homelab long-lived token), vault_openrouter_api_key (empty)

**homedev repo (https://github.com/eslick/homedev):**
- `deps.edn` — all service integration libraries
- `Dockerfile` — clojure:tools-deps-jammy + ripgrep; `RUN clojure -P -M:nrepl:dev`
- `dev/user.clj` — clj-reload + beholder (nextjournal.beholder) hot-reload init
- `src/homedev/core.clj` — minimal start!/stop!/restart! system stub
- `resources/config.edn` — Aero config with #env reader for all services
- `.mcp.json` — project-scoped clojure-mcp registration
- `.clojure-mcp/config.edn` — allowed directories and MCP settings
- `plans/implementation.md` — parallelizable component implementation plan

## Verification Steps

```bash
# Clojure CLI
clojure --version
# → Clojure CLI version 1.12.x

# Container running
docker ps | grep homedev
# → homedev   Up N seconds

# nREPL accessible
nc -z localhost 7888 && echo "OPEN"
# → OPEN

# Tailscale web UI
curl -sk https://speedracer.terrier-haddock.ts.net:3001 | head -3

# Claude Code MCP (run from ~/projects/homedev)
cd ~/projects/homedev && claude
# Then: /mcp → clojure-mcp should be listed
```

## Known Issues Fixed

- `clojure:tools-deps-1.12.0.1530-jammy` Docker tag does not exist → use
  `clojure:tools-deps-jammy` (floating latest Jammy tag)
- beholder namespace is `nextjournal.beholder`, not `com.nextjournal.beholder`
- Using `clojure -P -A:nrepl:dev` in Dockerfile with `:main-opts` in alias
  triggers deprecation warning and incomplete transitive dep download → use
  `clojure -P -M:nrepl:dev`

## Rollback

```bash
# Stop container
docker compose -f /opt/compose/homedev/docker-compose.yml down

# Remove compose directory
sudo rm -rf /opt/compose/homedev

# Remove nginx config
sudo rm /etc/nginx/sites-{available,enabled}/homedev
sudo systemctl reload nginx

# Remove UFW rule
sudo ufw delete allow in on tailscale0 to any port 3001 proto tcp

# Drop CRDB database (after confirming no important data)
docker exec cockroachdb cockroach sql --insecure -e "DROP DATABASE IF EXISTS homedev"
```
