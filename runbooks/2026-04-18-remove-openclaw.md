# Remove OpenClaw Installation

## Task
Remove the OpenClaw container, image, nginx reverse proxy, and UFW firewall rules while preserving all data created by the service.

## Playbook Used
`playbooks/remove-openclaw.yml`

## Retained Data — Where to Find It

### Docker named volume: `openclaw_openclaw-data`
Contains OpenClaw's internal state: conversation history, agent configurations, MCP server registrations, and gateway settings.

```bash
# Inspect the volume
docker volume inspect openclaw_openclaw-data

# Browse contents (mounts into a temporary container)
docker run --rm -it -v openclaw_openclaw-data:/data alpine sh -c "ls /data"
```

### Host cache directory: `/opt/cache/openclaw`
Model/embedding cache used by the QMD (BM25 search) plugin. Safe to delete if disk space is needed; it will be rebuilt on next run.

```bash
du -sh /opt/cache/openclaw
```

### Repo templates and files (for re-deployment)
The full OpenClaw configuration lives in this repo and can be used to redeploy:

| Path | Purpose |
|------|---------|
| `templates/openclaw-Dockerfile.j2` | Custom image with mcp-google + qmd patches |
| `templates/openclaw-compose.yml.j2` | Docker Compose service definition |
| `templates/openclaw-nginx.conf.j2` | Tailscale nginx reverse proxy config |
| `files/openclaw-entrypoint.sh` | Container entrypoint wrapper |
| `files/openclaw-workspace-agents-patch.md` | Workspace agents patch notes |
| `playbooks/docker.yml` (tags: openclaw) | Full deploy/configure tasks |
| `playbooks/nginx.yml` | Nginx site enable tasks |

## Re-deploying
```bash
ansible-playbook playbooks/docker.yml --tags openclaw
ansible-playbook playbooks/nginx.yml
```
The `openclaw_openclaw-data` volume will be reattached automatically.

## Verification Steps
```bash
# Confirm container is gone
docker ps -a | grep openclaw

# Confirm volume is present
docker volume ls | grep openclaw

# Confirm nginx site is disabled
ls /etc/nginx/sites-enabled/ | grep openclaw

# Confirm UFW rules removed
sudo ufw status | grep -E '18789|2099|2100'
```

## Rollback
Re-run the deploy playbooks above. Data volume is intact; no data was lost.
