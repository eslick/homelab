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
ansible-playbook playbooks/base.yml
ansible-playbook playbooks/tailscale.yml      # installs tailscaled; then `sudo tailscale up --accept-dns=false` (manual login) unless /var/lib/tailscale is restored in step 3
ansible-playbook playbooks/storage.yml        # mounts /mnt/nas (needs the NAS credentials from the vault)
ansible-playbook playbooks/gpu.yml            # then reboot
```
Disks: if the root LV needs growing, `playbooks/archive/lvm-extend.yml` records how it was done
(`runbooks/2026-04-01-lvm-extend.md`). The md0 array (`/mnt/data`, optional) is reassembled by hand per
`runbooks/2026-04-27-raid5-reassembly.md`; its fstab entry is `nofail`.

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
Restoring `/etc` overwrites system config with the old copies; step 4 reconciles anything that drifted.
If you restore onto a machine that already ran `base.yml`, review `/etc/fstab` and `/etc/netplan` afterwards.

### 4. Everything else
`playbooks/site.yml` is the aggregate desired state (one file per subsystem, imported in dependency
order). Clone Arcana first (`git clone https://github.com/eslick/arcana2 ~/projects/arcana2`, skipped if `/home` was restored), then:
```bash
ansible-playbook playbooks/site.yml --check --diff   # review
ansible-playbook playbooks/site.yml
```
Models re-download from Hugging Face on first inference. Not in `site.yml`: `optional/vllm.yml`
(alternate to SGLang, they share the GPU), `ops/system-upgrade.yml` (reboots), `archive/` (history).
Do not replay `archive/`, and ignore pre-2026-10 runbooks about CockroachDB, Datomic, homedev, AgentOS, OpenClaw.

Manual steps Ansible cannot do (so no runbook is needed): `tailscale up` login; Obsidian vault pairing
(below); re-authorizing Google
Workspace MCP if `/opt/secrets/google` is lost; the md0 array; Discord webhook/user id in the vault if the
browser-service notifications are wanted; the browser-service token lives in `~/.ssh/browser-service-token`
(generated on first use, restored with `/home`).

#### Obsidian vault sync (Syncthing, server ↔ MacBook)
`syncthing.yml` installs Syncthing and shares `/opt/vaults/obsidian` (port 22000 open on `tailscale0` only).
Device pairing is manual, and needed again on any new Mac or a fresh server identity (the server's Syncthing
identity lives in `/home/eslick/.local/share/syncthing`, restored with `/home`):
1. Mac: install Tailscale and sign in to the same tailnet; `brew install syncthing && brew services start syncthing`.
2. Server device ID: `syncthing --device-id` (also printed by `syncthing.yml`).
3. Mac UI `http://127.0.0.1:8384` → Add Remote Device with that ID, address `tcp://speedracer.terrier-haddock.ts.net:22000`.
4. Share the Mac vault folder to the server. Set the Mac folder to Send Only until the first sync finishes
   if the Mac vault should win; otherwise differences become `.sync-conflict` files.
5. Server UI via `ssh -L 8385:127.0.0.1:8384 speedracer.terrier-haddock.ts.net` → `http://127.0.0.1:8385`:
   accept the folder at `/opt/vaults/obsidian`.
6. `.stignore` on both sides: `.obsidian/workspace*.json` and `.obsidian/cache`.

The old CouchDB/LiveSync design is retired (`runbooks/2026-04-04-obsidian-livesync-writeback.md` is history only).

### 5. Verify
- `docker ps` all running/healthy; `systemctl --failed` empty.
- `sudo -E restic snapshots` shows a new snapshot after the next 03:00 run (or run `sudo /usr/local/bin/homelab-backup.sh`).
- `tailscale status`, then open `https://speedracer.terrier-haddock.ts.net`.
- Arcana: `docker exec arcana-dev printenv BROWSER_SERVICE_URL`, and `curl $BROWSER_SERVICE_URL/healthz` from inside it.
- Re-authorize Google Workspace MCP if `/opt/secrets/google` was lost (`runbooks/2026-04-06-google-workspace-mcp.md`).
- Run `make backup-credentials` once the new machine is healthy.

## Repository layout

- `playbooks/<subsystem>.yml` — desired state, one file per subsystem; `playbooks/site.yml` imports them all.
  `make drift` = `site.yml --check --diff`.
- `playbooks/{optional,ops,archive}/` — alternates, actions, and already-applied one-shots (not in `site.yml`).
- `runbooks/YYYY-MM-DD-<task>.md` — dated change log (why/how/verify/rollback). Not needed for a rebuild.
- Every change: edit the subsystem file, apply, log a runbook, commit and push (see `CLAUDE.md`).
