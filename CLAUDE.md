# Homelab Sysadmin — Standing Orders

## Server Identity
- OS: Ubuntu 24.04 LTS
- Role: Single-node homelab running Docker Compose workloads
- Containers: OpenClaw, hobby sites, utilities (see playbooks/docker.yml)
- Backup: Restic → NAS (/mnt/nas/backups/homelab) + S3
- Repo: ~/homelab → GitHub (this directory)

## THE PRIME DIRECTIVE
**Every system change MUST go through Ansible. No exceptions.**

Never run `sudo apt install`, `sudo systemctl enable`, or any direct mutation.
The correct workflow is:
1. Write or update the playbook in `playbooks/`
2. Run `ansible-playbook playbooks/<name>.yml --check --diff` first
3. If clean, apply: `ansible-playbook playbooks/<name>.yml`
4. Verify the change worked as expected
5. Commit: `git add -A && git commit -m "<type>(<scope>): <desc>" && git push`
6. Write runbook to `runbooks/YYYY-MM-DD-<task>.md`

## Playbook Conventions
- All tasks must be idempotent (safe to re-run multiple times)
- Use `become: yes` only on the specific tasks that require root, not at play level
- Prefer `ansible.builtin.*` modules over raw `shell:` or `command:`
- Tag every task: `tags: [install, configure, service, docker, backup, security]`
- When in doubt, add `creates:` or `when:` guards to prevent re-execution

## Docker Convention
- All containers defined in `playbooks/docker.yml` using community.docker.docker_compose_v2
- Compose files live at `/opt/compose/<service>/docker-compose.yml`
- Templates for compose files live in `templates/<service>-compose.yml.j2`
- Never run `docker run` directly; update the compose template and playbook

## Config File Convention
- Any file destined for /etc must have a source template in `templates/` or `files/`
- Before editing: `ansible-playbook playbooks/<name>.yml --check --diff`
- After applying: verify with `systemctl status <service>` or equivalent check

## Git Commit Convention
After every ansible-playbook run that changes state:
git add -A
git commit -m "<type>(<scope>): <description>"
git push origin main

Types: feat, fix, chore, docs, refactor, security
Examples:
  feat(docker): add vaultwarden container on port 8080
  fix(nginx): correct SSL certificate path in vhost config
  security(ufw): restrict port 8080 to LAN subnet only
  chore(backup): update restic retention to 14 daily snapshots

## Runbook Policy
After any task that changes system state, write a runbook:
- Path: `runbooks/YYYY-MM-DD-<task-slug>.md`
- Required sections: ## Task, ## Playbook Used, ## Verification Steps, ## Rollback
- Commit runbook in the same git commit as the playbook change

## Safety Rules
- Always run `--check --diff` before playbooks touching /etc or systemd units
- Explicitly list all `become: yes` tasks before running any playbook that uses sudo
- Never chain multiple destructive changes; verify between each
- For Docker volume data: confirm restic snapshot exists before modifying containers

## Health Check Mode (for cron -p invocation)
When invoked via `claude -p` in health check mode, perform these checks and ONLY these:
1. Disk usage per mount: alert threshold 80%
2. Memory usage: alert threshold 85%  
3. Docker containers: report any not in 'running' or 'healthy' state
4. Restic last snapshot: alert if most recent is >25 hours old
5. Failed systemd units: `systemctl --failed --no-pager`
6. Pending security updates: `apt list --upgradable 2>/dev/null | grep -i security`

Output: structured markdown to `health-reports/YYYY-MM-DD-HH.md`
If any alert threshold is exceeded, prefix filename with `ALERT-`
Then commit: `git add health-reports/ && git commit -m "health: $(date +%Y-%m-%d-%H)" && git push`
DO NOT run ansible-playbook or make system changes in health check mode.
