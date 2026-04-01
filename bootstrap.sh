#!/bin/bash
set -euo pipefail

echo "=== Phase 1: System prerequisites ==="
sudo apt update && sudo apt upgrade -y
sudo apt install -y \
  git curl wget unzip \
  ansible \
  python3-pip \
  docker.io docker-compose \
  restic \
  jq \
  nodejs npm

sudo usermod -aG docker "$USER"

echo "=== Phase 2: Claude Code ==="
sudo npm install -g @anthropic-ai/claude-code

echo "=== Phase 3: Homelab repo structure ==="
mkdir -p ~/homelab/{playbooks,roles,runbooks,inventory,group_vars,templates,.claude/rules,health-reports}
cd ~/homelab

cat > inventory/hosts.ini << 'INI'
[homelab]
localhost ansible_connection=local ansible_python_interpreter=/usr/bin/python3
INI

cat > ansible.cfg << 'CFG'
[defaults]
inventory           = inventory/hosts.ini
roles_path          = roles
retry_files_enabled = False
stdout_callback     = yaml
diff                = True

[privilege_escalation]
become        = False
become_method = sudo
CFG

cat > .gitignore << 'GIT'
*.retry
.env
secrets/
*.vault
__pycache__/
health-reports/   # optional: comment out if you want reports in git
GIT

echo "=== Phase 4: Claude permissions config ==="
mkdir -p .claude
cat > .claude/settings.json << 'JSON'
{
  "permissions": {
    "allow": [
      "Bash(ls:*)",
      "Bash(find:*)",
      "Bash(grep:*)",
      "Bash(cat:*)",
      "Bash(head:*)",
      "Bash(tail:*)",
      "Bash(df:*)",
      "Bash(du:*)",
      "Bash(ps:*)",
      "Bash(free:*)",
      "Bash(uptime:*)",
      "Bash(uname:*)",
      "Bash(ip:*)",
      "Bash(ss:*)",
      "Bash(docker ps:*)",
      "Bash(docker stats:*)",
      "Bash(docker logs:*)",
      "Bash(docker inspect:*)",
      "Bash(docker images:*)",
      "Bash(git:*)",
      "Bash(ansible-playbook:*)",
      "Bash(ansible-lint:*)",
      "Bash(systemctl status:*)",
      "Bash(systemctl list-units:*)",
      "Bash(journalctl:*)",
      "Bash(restic snapshots:*)",
      "Bash(restic stats:*)",
      "Write(*)"
    ],
    "deny": [
      "Bash(sudo rm -rf:*)",
      "Bash(sudo dd:*)",
      "Bash(sudo mkfs:*)",
      "Bash(sudo fdisk:*)",
      "Bash(sudo parted:*)",
      "Bash(sudo wipefs:*)"
    ]
  }
}
JSON

echo "=== Phase 5: CLAUDE.md (standing orders) ==="
cat > CLAUDE.md << 'CLAUDE'
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
2. **Auto-apply**: after editing a playbook, immediately run it through the apply cycle below
3. Verify the change worked as expected
4. Commit: `git add -A && git commit -m "<type>(<scope>): <desc>" && git push`
5. Write runbook to `runbooks/YYYY-MM-DD-<task>.md`

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

Output: structured markdown to `health-reports/YYYY-MM-DD-HH.md`
If any alert threshold is exceeded, prefix filename with `ALERT-`
Then commit: `git add health-reports/ && git commit -m "health: $(date +%Y-%m-%d-%H)" && git push`
DO NOT run ansible-playbook or make system changes in health check mode.
CLAUDE

echo "=== Phase 6: Ansible path-scoped rule ==="
cat > .claude/rules/ansible-discipline.md << 'RULES'
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
RULES

echo "=== Phase 7: Starter playbooks ==="

cat > playbooks/system.yml << 'YAML'
---
- name: System baseline
  hosts: homelab
  gather_facts: yes

  tasks:
    - name: Ensure essential packages are installed
      ansible.builtin.apt:
        name:
          - curl
          - wget
          - git
          - htop
          - unzip
          - fail2ban
          - ufw
          - restic
          - jq
        state: present
        update_cache: yes
      become: yes
      tags: [install]

    - name: Set timezone to US/Pacific
      community.general.timezone:
        name: America/Los_Angeles
      become: yes
      tags: [configure]

    - name: Allow SSH through UFW
      ansible.builtin.command: ufw allow OpenSSH
      become: yes
      changed_when: true
      tags: [security]

    - name: Enable UFW
      ansible.builtin.command: ufw --force enable
      become: yes
      changed_when: true
      tags: [security]

    - name: Ensure Docker is running and enabled
      ansible.builtin.service:
        name: docker
        state: started
        enabled: yes
      become: yes
      tags: [service, docker]

    - name: Ensure fail2ban is running
      ansible.builtin.service:
        name: fail2ban
        state: started
        enabled: yes
      become: yes
      tags: [service, security]

    - name: Deploy homelab CLI wrapper
      ansible.builtin.copy:
        dest: /usr/local/bin/homelab
        mode: '0755'
        content: |
          #!/bin/bash
          # Launch Claude Code in the homelab repo with auto-approval
          cd ~/homelab
          exec claude --dangerously-skip-permissions "\$@"
      become: yes
      tags: [configure, claude]
YAML

cat > playbooks/docker.yml << 'YAML'
---
# Manages all Docker Compose services.
# Add new containers by:
#   1. Adding an entry to the `services` var
#   2. Creating a template in templates/<service>-compose.yml.j2
#   3. Running: ansible-playbook playbooks/docker.yml --check --diff
#   4. Applying: ansible-playbook playbooks/docker.yml

- name: Manage Docker Compose services
  hosts: homelab
  gather_facts: no

  vars:
    compose_base: /opt/compose
    services:
      - name: openclaw
        port: 18789
      # - name: your-next-service
      #   port: 8080

  tasks:
    - name: Ensure compose directories exist
      ansible.builtin.file:
        path: "{{ compose_base }}/{{ item.name }}"
        state: directory
        mode: '0755'
      loop: "{{ services }}"
      become: yes
      tags: [docker]

    - name: Allow service ports through UFW
      ansible.builtin.command: "ufw allow {{ item.port }}/tcp"
      loop: "{{ services }}"
      become: yes
      changed_when: true
      tags: [docker, security]
YAML

cat > playbooks/backup.yml << 'YAML'
---
- name: Configure Restic backup schedule
  hosts: homelab
  gather_facts: no

  vars:
    backup_script: /usr/local/bin/homelab-backup.sh
    restic_nas_repo: /mnt/nas/backups/homelab
    restic_s3_repo: "s3:s3.amazonaws.com/YOUR-BUCKET/homelab"
    restic_password_file: /etc/restic/password
    backup_paths:
      - /home
      - /etc
      - /opt/compose
      - /var/lib/docker/volumes

  tasks:
    - name: Ensure /etc/restic directory
      ansible.builtin.file:
        path: /etc/restic
        state: directory
        mode: '0700'
        owner: root
        group: root
      become: yes
      tags: [backup]

    - name: Deploy backup script
      ansible.builtin.copy:
        dest: "{{ backup_script }}"
        mode: '0755'
        content: |
          #!/bin/bash
          set -euo pipefail
          export RESTIC_PASSWORD_FILE="{{ restic_password_file }}"
          export AWS_ACCESS_KEY_ID="$(cat /etc/restic/aws_key_id)"
          export AWS_SECRET_ACCESS_KEY="$(cat /etc/restic/aws_secret)"
          LOG=/var/log/restic-backup.log
          exec &>> "$LOG"
          echo "=== Backup started $(date) ==="
          restic -r {{ restic_nas_repo }} backup {{ backup_paths | join(' ') }} \
            --exclude="*.tmp" --exclude="*.log" \
            --tag "$(hostname)" --tag "automated"
          restic -r {{ restic_nas_repo }} copy \
            --to {{ restic_s3_repo }}
          restic -r {{ restic_nas_repo }} forget \
            --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune
          echo "=== Backup complete $(date) ==="
      become: yes
      tags: [backup]

    - name: Schedule backup at 3am daily
      ansible.builtin.cron:
        name: homelab-restic-backup
        minute: "0"
        hour: "3"
        job: "{{ backup_script }}"
        user: root
      become: yes
      tags: [backup, cron]
YAML

cat > playbooks/claude-health-cron.yml << 'YAML'
---
# Sets up the claude -p health check cron job.
# Runs 3x daily and commits health reports to git.

- name: Configure Claude health check cron
  hosts: homelab
  gather_facts: no

  vars:
    health_script: /usr/local/bin/homelab-health-check.sh
    api_key_file: /etc/claude/api_key
    homelab_dir: "{{ ansible_env.HOME }}/homelab"

  tasks:
    - name: Ensure /etc/claude directory
      ansible.builtin.file:
        path: /etc/claude
        state: directory
        mode: '0700'
        owner: root
        group: root
      become: yes
      tags: [claude, configure]

    - name: Ensure health-reports directory exists
      ansible.builtin.file:
        path: "{{ homelab_dir }}/health-reports"
        state: directory
        mode: '0755'
      tags: [claude]

    - name: Deploy health check script
      ansible.builtin.copy:
        dest: "{{ health_script }}"
        mode: '0755'
        content: |
          #!/bin/bash
          # Claude-driven health check (headless -p mode)
          # Read-only: checks system state, writes report, commits to git
          # Does NOT run playbooks or make changes

          cd {{ homelab_dir }}
          export ANTHROPIC_API_KEY="$(cat {{ api_key_file }} 2>/dev/null)"

          if [ -z "$ANTHROPIC_API_KEY" ]; then
            echo "ERROR: No API key found at {{ api_key_file }}" >&2
            exit 1
          fi

          claude -p \
            --allowedTools "Bash,Write" \
            --max-turns 15 \
            "You are running in HEALTH CHECK MODE. Follow the ## Health Check Mode section in CLAUDE.md exactly. Check all six health indicators, write the markdown report to health-reports/, prefix with ALERT- if any threshold is exceeded, then commit and push. Do not make any system changes."

          echo "Health check run completed at $(date)"
      become: yes
      tags: [claude]

    - name: Schedule health checks (8am, 2pm, 8pm)
      ansible.builtin.cron:
        name: "claude-health-check-{{ item.name }}"
        minute: "0"
        hour: "{{ item.hour }}"
        job: "{{ health_script }} >> /var/log/claude-health.log 2>&1"
        user: "{{ ansible_env.USER }}"
      loop:
        - { name: morning, hour: "8" }
        - { name: afternoon, hour: "14" }
        - { name: evening, hour: "20" }
      tags: [claude, cron]
YAML

echo "=== Phase 8: Sudoers entry for ansible-playbook ==="
sudo bash -c "echo '${USER} ALL=(ALL) NOPASSWD: /usr/bin/ansible-playbook' > /etc/sudoers.d/ansible-playbook"
sudo chmod 440 /etc/sudoers.d/ansible-playbook

echo "=== Phase 9: Git init and initial commit ==="
cd ~/homelab
git init
git branch -M main
git add -A
git commit -m "chore(init): bootstrap homelab ansible + claude sysadmin setup"

echo ""
echo "========================================================"
echo "Bootstrap complete!"
echo ""
echo "Required manual steps:"
echo "  1. Store your Anthropic API key:"
echo "     sudo mkdir -p /etc/claude"
echo "     echo 'sk-ant-YOUR-KEY' | sudo tee /etc/claude/api_key"
echo "     sudo chmod 600 /etc/claude/api_key"
echo ""
echo "  2. Initialize Restic repos:"
echo "     restic init --repo /mnt/nas/backups/homelab"
echo "     restic init --repo s3:s3.amazonaws.com/YOUR-BUCKET/homelab"
echo "     echo 'your-restic-password' | sudo tee /etc/restic/password"
echo "     sudo chmod 600 /etc/restic/password"
echo ""
echo "  3. Push to GitHub:"
echo "     git remote add origin git@github.com:YOU/homelab.git"
echo "     git push -u origin main"
echo ""
echo "  4. Run baseline playbook:"
echo "     ansible-playbook playbooks/system.yml --check --diff"
echo "     ansible-playbook playbooks/system.yml"
echo ""
echo "  5. Install health check cron:"
echo "     ansible-playbook playbooks/claude-health-cron.yml --check --diff"
echo "     ansible-playbook playbooks/claude-health-cron.yml"
echo ""
echo "  6. Start sysadmin session (auto-approval mode):"
echo "     homelab"
echo "========================================================"
