## Task
Label Claude Code sessions launched from the helper wrappers (`homelab`, `homedev`, `arcana`) by passing `--name <label>`, so sessions are identifiable in the prompt box and `/resume`.

## Playbook Used
- `playbooks/system.yml` (tags: `configure,claude`): "Deploy homelab CLI wrapper", "Deploy homedev CLI wrapper", "Deploy arcana CLI wrapper" now exec `claude --name <label> --dangerously-skip-permissions "$@"`. Extra CLI args follow the label and can override it.

## Verification Steps
1. `ansible-playbook playbooks/system.yml --check --diff --tags configure,claude` — only the 3 wrappers changed.
2. Applied: changed=3.
3. `grep exec /usr/local/bin/{homelab,homedev,arcana}` shows the `--name` flag with the right label.

## Rollback
```
git revert <this-commit-sha>
ansible-playbook playbooks/system.yml --tags configure,claude
```
