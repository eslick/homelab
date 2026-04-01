---
paths: ["playbooks/**/*.yml", "roles/**/*.yml", "templates/**"]
---
You are editing an Ansible playbook or template.

Rules:
- All tasks must be idempotent — safe to run multiple times
- Use ansible.builtin.* modules over raw shell/command where possible
- become: yes on task level only, not play level
- Every task needs a name and at least one tag
- After writing, validate with: ansible-lint <file>
- Run with --check --diff before applying
