# Retire Obsidian LiveSync (CouchDB) leftovers; document Syncthing pairing

## Task
The Obsidian vault is synced by Syncthing, but `playbooks/obsidian-sync.yml` (CouchDB LiveSync
`obsidian-sync` + `obsidian-vault-writeback`) was still imported by `site.yml`, so a rebuild would have
redeployed dead services. The README also had no Syncthing/Mac pairing steps.

Changes:
- Deleted `playbooks/obsidian-sync.yml` and its 7 templates (`obsidian-*`, `vault-writeback.sh.j2`); still in git history.
- Removed it from `site.yml`; CLAUDE.md subsystem list now reads `syncthing (Obsidian vault)`.
- `playbooks/syncthing.yml` now owns the vault and holds `state: absent` tasks (tag `retire`) for the
  stopped services, root cron job, unit files, `/opt/scripts/obsidian-sync.py` and `/opt/obsidian`.
- README "Full rebuild" gained the Mac/Syncthing pairing steps.

## Playbook Used
`playbooks/syncthing.yml --tags retire,cron,service,configure` (dry run first). `become` tasks: stop/disable
services, remove cron, remove units/scripts, daemon-reload.

## Verification Steps
- `ls /etc/systemd/system | grep obsid` empty; `/opt/obsidian` gone; root crontab has no obsidian entry.
- `systemctl is-active syncthing@eslick` → active; `systemctl --failed` empty; vault dir intact.

## Rollback
`git revert` this commit and run `ansible-playbook playbooks/obsidian-sync.yml` (restores services, needs
the CouchDB stack too, see below). Not recommended.

## Left in place (data, needs a decision)
`/opt/compose/obsidian-couchdb/` and docker volume `obsidian-couchdb_couchdb-data` (old LiveSync database,
contains the CouchDB admin password in its compose file). Not referenced by any playbook. Remove with a
`state: absent` task once confirmed unneeded; the volume is covered by the restic backup.
`vault_couchdb_admin_*` vars remain in the ansible vault, unused.

## Update: CouchDB data deleted (user-approved)
`syncthing.yml` (tag `retire`) now runs `docker_compose_v2 state: absent remove_volumes: yes` and removes
`/opt/compose/obsidian-couchdb`; `vault_couchdb_admin_*` removed from `group_vars/all.yml`. Verified: no
`obsidian-couchdb_couchdb-data` volume, `/opt/compose` lacks the dir. Recovery: the restic snapshot of
2026-10-12 03:00 still contains `/var/lib/docker/volumes/obsidian-couchdb_couchdb-data`.
The "Left in place" section above is therefore obsolete.
