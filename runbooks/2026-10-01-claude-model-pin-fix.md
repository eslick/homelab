## Task
`homelab` and `homedev` CLI wrappers kept launching Claude Code on `claude-sonnet-4-6` even after the user set `claude-sonnet-5` as their default via `/model`. Root cause: both wrapper scripts, plus the health-check cron playbook, hardcoded `--model claude-sonnet-4-6` on the `claude` invocation — a CLI flag always overrides the saved config default.

## Playbook Used
- `playbooks/system.yml` (tags: `configure,claude`) — updated the "Deploy homelab CLI wrapper" and "Deploy homedev CLI wrapper" tasks to pass `--model claude-sonnet-5` instead of `claude-sonnet-4-6`; also updated the comment referencing `--model claude-opus-4-6` to `claude-opus-5-5`.
- `playbooks/claude-health-cron.yml` — updated the health check script's `claude -p --model` flag from `claude-sonnet-4-6` to `claude-sonnet-5`.

## Verification Steps
1. `ansible-playbook playbooks/system.yml --check --diff --tags configure,claude` — confirmed diff touched only the two wrapper scripts.
2. `ansible-playbook playbooks/system.yml --tags configure,claude` — applied.
3. `cat /usr/local/bin/homelab` and `cat /usr/local/bin/homedev` — confirmed both now invoke `--model claude-sonnet-5`.
4. `ansible-playbook playbooks/claude-health-cron.yml --check --diff` — confirmed diff touched only the health check script's model flag.
5. `ansible-playbook playbooks/claude-health-cron.yml` — applied.
6. `grep -rn "claude-sonnet-4-6\|claude-opus-4-6" playbooks/ templates/ files/` — no remaining stale model references.

## Rollback
Revert the playbook changes in this commit and re-run:
```
git revert <this-commit-sha>
ansible-playbook playbooks/system.yml --tags configure,claude
ansible-playbook playbooks/claude-health-cron.yml
```
