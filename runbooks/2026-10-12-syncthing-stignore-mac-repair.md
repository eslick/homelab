# Syncthing: re-pair reinstalled MacBook, deploy vault .stignore

## Task
The MacBook was reinstalled, so it presented a new Syncthing ID (`FHXONAB-...`) and the server logged
"rejected: unknown device". Server config still held the old ID (`A67PI5O-...`). Also added a vault `.stignore`
to stop Obsidian UI-state files causing `.sync-conflict` copies.

## Playbook Used
`playbooks/syncthing.yml --tags configure` (dry run first) adds the `.stignore` task. Pairing was manual via
`syncthing cli` as `eslick` (Ansible cannot do device approval): added the new device, shared folder
`pcplt-gedfg` ("Open Claw", `/opt/vaults/obsidian`) with it, removed the old device and its folder share.

## Verification Steps
- `journalctl -u syncthing@eslick`: "Established secure connection to FHXONAB", folder ready.
- `syncthing cli show connections`: FHXONAB connected. `/opt/vaults/obsidian/.stignore` present, owner eslick.
- Mac opened the synced folder as an Obsidian vault.

## Rollback
Delete the `.stignore` task and the file; re-add the old device ID with `syncthing cli config devices add` if ever needed.

## Notes
Already-synced `.obsidian/workspace.json` remains on the server (ignored files are not deleted); old
`*.sync-conflict-20260405-*` files in the vault are left untouched for manual review.
