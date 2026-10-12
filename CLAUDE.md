# Homelab Sysadmin — Standing Orders

## Server Identity
- OS: Ubuntu 24.04 LTS
- Role: Single-node homelab running Docker Compose workloads
- Containers: YugabyteDB, MinIO, Arcana 2, SGLang, Home Assistant, browser service (see playbooks/docker.yml and the other subsystem files)
- Backup: Restic → NAS (/mnt/nas/backups/homelab) (NAS backs up to S3 independently)
- Repo: ~/homelab → GitHub (this directory)

## THE PRIME DIRECTIVE
**Every system change MUST go through Ansible. No exceptions.**

Never run `sudo apt install`, `sudo systemctl enable`, or any direct mutation.

## Repository Model: state files + a change log
- `playbooks/*.yml` — **one file per subsystem**, each describing the *current desired state*
  (base, tailscale, storage, gpu, power, postfix, docker, nginx, sglang, browser-service,
  homeassistant, syncthing (Obsidian vault), arcana2, monitoring, devtools, claude, backup).
  `playbooks/site.yml` imports them in dependency order and is the whole-machine state.
- `runbooks/YYYY-MM-DD-<task>.md` — the **time-indexed log** of what changed and why. Append-only history.
- **Never add a new dated or one-off playbook for a change.** Edit the subsystem file that owns the
  thing, so the playbooks always equal the aggregate of every change ever made. If the thing is new,
  add a subsystem file and import it in `site.yml`.
- Removing something = a `state: absent` task in the owning subsystem file (confirm with the user first
  if it deletes data), not a `retire-*` playbook. Already-applied one-shots live in `playbooks/archive/`;
  alternates that conflict with the default live in `playbooks/optional/`; actions rather than state
  (e.g. reboot-ing upgrades) live in `playbooks/ops/`. None of those are imported by `site.yml`.
- Anything done by hand that Ansible cannot do (OAuth logins, `tailscale up`, RAID assembly) goes in the
  README "Full rebuild" section, so a rebuild never depends on reading the runbook history.

## Change Workflow (every change, every time)
1. Edit the owning subsystem playbook (and its template/vars).
2. **Auto-apply** it through the cycle in "Playbook Auto-Apply" below.
3. Verify the change worked as expected.
4. Write the dated log entry `runbooks/YYYY-MM-DD-<task>.md` (what, why, playbook + tags used, verification, rollback).
5. **Commit and push, every time**: `git add -A && git commit -m "<type>(<scope>): <desc>" && git push origin main`
   — playbook, templates, README changes and the runbook go in the same commit. Do not leave changes
   unpushed at the end of a task, and do not batch several changes into one push.
6. If the change affects how to rebuild (new service, new manual step, new secret location), update `README.md`.

## Playbook Auto-Apply
After writing or editing a playbook, automatically apply it using this sequence:

1. **Dry run first — always**: `ansible-playbook playbooks/<name>.yml --check --diff [--tags <tag>]`
2. Review the dry-run output for unexpected changes. Stop and ask the user if anything looks wrong.
3. **Apply**: `ansible-playbook playbooks/<name>.yml [--tags <tag>]`
4. **Verify**: run an appropriate check (e.g., `systemctl status`, `docker ps`, `which <cmd>`)

### Incremental runs with tags
When you know which tasks were changed, use `--tags` to run only the affected subset:
- Pass `--tags <tag>` matching the tags on the changed tasks
- Example: edited only the backup cron task → `--tags cron,backup`
- `ansible-playbook playbooks/site.yml --check --diff` is the whole-host drift report; run it when unsure.
  Known dry-run-only noise: `get_url` apt keys and compose `build` report "changed" under `--check`.
- When adding a new task or unsure of impact, run the full playbook without `--tags`

### When NOT to auto-apply
- Health check mode (`claude -p` cron) — never run playbooks
- If the dry run shows unexpected changes — stop and confirm with the user
- If the playbook touches destructive operations (removing packages, dropping volumes) — confirm first

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
- The dry run in Playbook Auto-Apply satisfies the `--check --diff` requirement
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
7. GPU & CPU temperatures: alert if any GPU ≥ 85°C or CPU ≥ 85°C; note trend direction from recent readings (rising/stable/falling); data provided by `check-temps` in the system data block

Output: structured markdown to `health-reports/YYYY-MM-DD-HH.md`
If any alert threshold is exceeded, prefix filename with `ALERT-`
Then commit: `git add health-reports/ && git commit -m "health: $(date +%Y-%m-%d-%H)" && git push`
DO NOT run ansible-playbook or make system changes in health check mode.

## Locally Developed Applications from Source
- Are stored in projects/<project>
- Must be deployed using ansible and docker-compose unless specified otherwise
- Exception: arcana2 runs from its own `docker/compose.dev.yml` in the repo (also used by `make dev.up`); `playbooks/arcana2.yml` drives that file directly instead of a template copy, so don't re-add one