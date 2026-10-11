#!/bin/bash
# Copy the two passwords needed to open the restic repo and the Ansible vault to the NAS,
# outside the restic repo, so a rebuild can start from the NAS alone.
# Interactive: scp prompts for the NAS password (no key is installed on the NAS).
#   make backup-credentials
# Override the NAS-side path if the share lives elsewhere on the NAS filesystem:
#   NAS_SCP_DEST=eslick@192.168.50.101:/volume1/ServerBackup/backups/rebuild-secrets/ make backup-credentials
set -euo pipefail

DEST="${NAS_SCP_DEST:-eslick@192.168.50.101:/share/ServerBackup/backups/rebuild-secrets/}"
VERIFY_DIR=/mnt/nas/backups/rebuild-secrets   # same location via the CIFS mount

stage=$(mktemp -d); trap 'rm -rf "$stage"' EXIT; chmod 700 "$stage"
sudo cat /etc/restic/password > "$stage/restic-password"
cp ~/.vault_pass "$stage/vault_pass"
chmod 600 "$stage"/*

scp -p "$stage/restic-password" "$stage/vault_pass" "$DEST"

for f in restic-password vault_pass; do
  [ -s "$VERIFY_DIR/$f" ] || { echo "scp finished but $VERIFY_DIR/$f is missing; check NAS_SCP_DEST" >&2; exit 1; }
done
echo "OK: $(ls "$VERIFY_DIR" | tr '\n' ' ')in $VERIFY_DIR"
