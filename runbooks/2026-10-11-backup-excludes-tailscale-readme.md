# Backup: exclude re-creatable data, add Tailscale state, README rebuild guide

## Task
Cut restic size by excluding model weights and Arcana build caches, add `/var/lib/tailscale`, add a command to put the restic and vault passwords on the NAS outside restic, and document backup assumptions and the full rebuild in `README.md`.

## Playbook Used
`playbooks/backup.yml` (new `backup_excludes` list, `/var/lib/tailscale` in `backup_paths`). Applied with the usual dry run first. `become: yes` tasks: `/etc/restic` dir, backup script deploy, root cron entry. New: `scripts/backup-credentials-to-nas.sh` + `make backup-credentials` (manual, interactive scp, not Ansible-run), `README.md`.

## Verification Steps
1. `bash -n /usr/local/bin/homelab-backup.sh`.
2. `restic backup --dry-run /var/lib/docker/volumes /var/lib/tailscale <excludes>` processed 71.5 GiB (down from ~296 GiB of volumes).
3. Next 03:00 run: `restic snapshots` shows a snapshot containing `/var/lib/tailscale` and no `vllm-models`.
4. `make backup-credentials`, then `ls /mnt/nas/backups/rebuild-secrets` (not yet run; needs the NAS password and the correct NAS-side path).

## Rollback
Revert the commit and re-run `ansible-playbook playbooks/backup.yml --tags backup`. Existing snapshots are untouched; the excluded volumes simply stop being added.
