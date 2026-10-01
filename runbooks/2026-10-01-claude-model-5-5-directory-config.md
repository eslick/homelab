## Task
Move Claude Code model selection from hardcoded `--model` CLI flags to per-directory `.claude/settings.json` config, and upgrade the default model to `claude-sonnet-5-5` everywhere.

## Playbook Used
- `playbooks/system.yml` (tags: `configure,claude`):
  - "Deploy homelab CLI wrapper" / "Deploy homedev CLI wrapper" — dropped `--model claude-sonnet-5` from the `claude` invocation; the wrapper now relies on the directory's own Claude config.
  - Added "Ensure homedev .claude directory exists" and "Deploy homedev Claude directory config" tasks to create `/home/eslick/projects/homedev/.claude/settings.json` with `{"model": "claude-sonnet-5-5"}`, since that project previously had no directory-level Claude config at all.
- `playbooks/claude-health-cron.yml` — dropped `--model claude-sonnet-5` from the health-check `claude -p` invocation. The script already `cd`s into `{{ homelab_dir }}` before running, so it picks up that directory's `.claude/settings.json`.

Also updated directly (not Ansible-managed — these are app-level config files, not OS/system resources):
- `/home/eslick/homelab/.claude/settings.json` — `model` → `claude-sonnet-5-5` (checked into this repo).
- `~/.claude/settings.json` (global default) — `model` → `claude-sonnet-5-5`.

## Verification Steps
1. `ansible-playbook playbooks/system.yml --check --diff --tags configure,claude` — confirmed diff: wrapper scripts lost `--model` flag, new homedev `.claude/settings.json` task showed as additive.
2. `ansible-playbook playbooks/system.yml --tags configure,claude` — applied, 4 changed.
3. `ansible-playbook playbooks/claude-health-cron.yml --check --diff` — confirmed diff removed only the `--model` line.
4. `ansible-playbook playbooks/claude-health-cron.yml` — applied, 1 changed.
5. Verified file contents:
   - `/usr/local/bin/homelab` and `/usr/local/bin/homedev` — no `--model` flag.
   - `/home/eslick/projects/homedev/.claude/settings.json` — `{"model": "claude-sonnet-5-5"}`.
   - `/home/eslick/homelab/.claude/settings.json` and `~/.claude/settings.json` — `model: claude-sonnet-5-5`.
   - `/usr/local/bin/homelab-health-check.sh` — no `--model` flag.
6. `grep -rn "claude-sonnet-5\b" playbooks/ templates/ files/` (excluding `-5-5` matches) — no stray references left.

## Rollback
```
git revert <this-commit-sha>
ansible-playbook playbooks/system.yml --tags configure,claude
ansible-playbook playbooks/claude-health-cron.yml
```
Also manually revert `~/.claude/settings.json`'s `model` field (not Ansible-managed, so a `git revert` won't touch it).
