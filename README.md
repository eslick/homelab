# homelab

Single-node Ubuntu 24.04 server ("speedracer") managed entirely with Ansible. Standing orders for
day-to-day changes live in `CLAUDE.md`; per-change history is in `runbooks/`. This file is the
**backup assumptions and full-rebuild guide**.

## Backup model and assumptions

| Layer | What | Where |
|---|---|---|
| Config as code | playbooks, templates, vars, vault-encrypted `group_vars/all.yml`, runbooks | GitHub `eslick/homelab` |
| Application source | `~/projects/arcana2` (own repo, `eslick/arcana2`) | GitHub; **push it, only pushed commits are safe** |
| Machine state | restic, daily 03:00 (`playbooks/backup.yml`) | NAS `/mnt/nas/backups/homelab` |
| Rebuild secrets | restic password + vault password | NAS `/mnt/nas/backups/rebuild-secrets` (`make backup-credentials`) |
| Off-site | the whole NAS share | S3, **configured on the NAS itself, not in this repo** |

Assumptions (state them, do not rediscover them):

- **NAS to S3 replication is the NAS's own job.** Nothing here configures, monitors or tests it. If it
  breaks, the only off-machine copy is the NAS.
- **Restic covers** `/home`, `/etc`, `/opt/compose`, `/opt/vaults`, `/opt/cache`,
  `/var/lib/docker/volumes`, `/var/lib/tailscale` (node identity). Retention: 7 daily, 4 weekly, 12 monthly.
- **Deliberately not backed up** (re-creatable): model weights (`vllm-models`, `vllm_vllm-models`) and
  Arcana/Elixir build caches (`aa-*`, `arcana-dev_arcana-*`, `wt-agent_llm_opts-*`).
- **`/mnt/data` (md0 RAID array, legacy disks for large datasets) is unused and not backed up.** It
  holds only old photos; treat it as unprotected storage.
- **Restic and the vault passwords are not recoverable from restic alone**: `/etc/restic/password`
  is inside the repo it unlocks. That is what the NAS copy (below) is for. Keep a third copy in your password manager.
- Databases (Yugabyte, MinIO, CouchDB) are captured by file copy of live Docker volumes, i.e.
  crash-consistent only. No dump step exists yet.
- `/opt/secrets` is not in the restic paths. Most files are regenerated from the vault by
  `arcana2.yml` / `browser-service.yml`; `/opt/secrets/google/` (Workspace MCP OAuth token) is not
  and would need re-authorizing.

### Refresh the rebuild secrets on the NAS

Run after any change to the restic or vault password (it prompts for the NAS password):

```bash
make backup-credentials      # scp /etc/restic/password and ~/.vault_pass -> NAS rebuild-secrets/
```

If the NAS filesystem path differs from the default, set `NAS_SCP_DEST=user@192.168.50.101:/real/path/`.
The script verifies the files arrived through the CIFS mount.

## Full rebuild from scratch

Untested end to end; the order is derived from playbook dependencies. Fix this section when a real restore teaches you something.

### 0. What you need from outside the machine
1. The NAS (`192.168.50.101`, share `ServerBackup`) reachable, and the NAS user's password.
2. From the NAS `rebuild-secrets/` folder (or your password manager): `restic-password`, `vault_pass`.
3. A GitHub credential able to clone `eslick/homelab` and `eslick/arcana2` (the deploy key `~/.ssh/id_rsa_git` is in the restic snapshot under `/home`).

### 1. Base OS and repo
1. Install Ubuntu 24.04 LTS (user `eslick`, passwordless sudo: `files/sudoers-eslick`), update, reboot.
2. `sudo apt install -y git ansible restic cifs-utils` and `ansible-galaxy collection install community.docker`.
3. `git clone https://github.com/eslick/homelab ~/homelab`
4. Place `vault_pass` at `~/.vault_pass` (`chmod 600`). `ansible.cfg` reads it automatically.
   (`bootstrap.sh` is an outdated first-install helper; do not rely on it.)

### 2. Foundations
```bash
cd ~/homelab
ansible-playbook playbooks/system.yml
ansible-playbook playbooks/nas.yml          # mounts /mnt/nas (needs the NAS credentials from the vault)
ansible-playbook playbooks/gpu.yml          # then reboot
ansible-playbook playbooks/power.yml
ansible-playbook playbooks/postfix.yml
```
Disks: if the root LV needs growing use `playbooks/lvm-extend.yml` (`runbooks/2026-04-01-lvm-extend.md`).
The md0 array (`/mnt/data`, optional) is reassembled by hand per `runbooks/2026-04-27-raid5-reassembly.md`; the fstab entry is `nofail`.

### 3. Restore data with containers stopped
```bash
sudo mkdir -p /etc/restic && sudo install -m 640 -o root -g eslick restic-password /etc/restic/password
export RESTIC_PASSWORD_FILE=/etc/restic/password RESTIC_REPOSITORY=/mnt/nas/backups/homelab
sudo -E restic snapshots                       # confirm the repo opens
sudo systemctl stop docker docker.socket       # if Docker is already installed
sudo -E restic restore latest --target / \
  --include /etc --include /home --include /opt/compose --include /opt/vaults \
  --include /opt/cache --include /var/lib/docker/volumes --include /var/lib/tailscale
sudo systemctl restart tailscaled              # reuses the restored node identity
tailscale status                               # should be the original speedracer, not a new node
```
Restoring `/etc` overwrites system config with the old copies; re-running the playbooks in step 4
reconciles anything that drifted. If you restore onto a machine that already ran `system.yml`, review `/etc/fstab` and `/etc/netplan` afterwards.

### 4. Services (re-run, all idempotent)
```bash
ansible-playbook playbooks/backup.yml           # restic script + 03:00 cron
ansible-playbook playbooks/docker.yml           # engine + compose-managed services (yugabyte, minio, couchdb...)
ansible-playbook playbooks/nginx.yml
ansible-playbook playbooks/tailscale-serve.yml
ansible-playbook playbooks/sglang.yml           # or: make sglang-moe ; models re-download from Hugging Face
ansible-playbook playbooks/browser-service.yml
ansible-playbook playbooks/homeassistant.yml
ansible-playbook playbooks/obsidian-sync.yml
ansible-playbook playbooks/syncthing.yml
git clone https://github.com/eslick/arcana2 ~/projects/arcana2   # skipped if /home was restored
ansible-playbook playbooks/arcana2.yml          # --tags secrets first if you want to stage env files only
ansible-playbook playbooks/claude-health-cron.yml
```
Do not replay `retire-*`, `remove-*` playbooks or the pre-2026-10 runbooks about CockroachDB, Datomic, homedev, AgentOS, OpenClaw.

### 5. Verify
- `docker ps` all running/healthy; `systemctl --failed` empty.
- `sudo -E restic snapshots` shows a new snapshot after the next 03:00 run (or run `sudo /usr/local/bin/homelab-backup.sh`).
- `tailscale status`, then open `https://speedracer.terrier-haddock.ts.net`.
- Arcana: `docker exec arcana-dev printenv BROWSER_SERVICE_URL`, and `curl $BROWSER_SERVICE_URL/healthz` from inside it.
- Re-authorize Google Workspace MCP if `/opt/secrets/google` was lost (`runbooks/2026-04-06-google-workspace-mcp.md`).
- Run `make backup-credentials` once the new machine is healthy.

## Runbook index

Runbooks are a change log, `runbooks/YYYY-MM-DD-<task>.md`. For restore-relevant ones grep by service name
(`nas-mount`, `raid5-reassembly`, `yugabytedb`, `minio-*`, `homeassistant`, `browser-service`, `arcana-*`, `sglang-*`, `tailscale-*`).
