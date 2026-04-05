# Obsidian LiveSync Write-Back Debugging & Fix

**Date:** 2026-04-04  
**Status:** Resolved

## Task

Debug and fix the bidirectional sync between OpenClaw (AI agent) files and the MacBook
Obsidian vault via CouchDB Self-Hosted LiveSync.

## Root Causes Found

### 1. Sync Loop (Exponential Base64 Corruption)
Both services watched overlapping paths. `obsidian-sync.py` wrote CouchDB content to
disk (including `OpenClaw/`), which triggered `vault-writeback.sh`'s inotifywait, which
pushed back to CouchDB, which triggered another write — a feedback loop. Files grew from
~243 bytes to ~10MB (37 rounds of base64 encoding).

**Fix:** `obsidian-sync.py` now has `SKIP_PATHS = ["OpenClaw/"]`. `vault-writeback.sh`
only watches `OpenClaw/` (not the full vault).

### 2. LiveSync Leaf Format — Base64 Required
After fixing the sync loop, the leaf `data` field was changed to plain text. However,
the MacBook's Obsidian LiveSync plugin expects **base64-encoded** content in leaf docs
for agent-written (small, single-chunk) files. The MacBook was immediately re-encoding
our plain text leaves to base64 (causing 409 Conflicts on subsequent writes).

**Fix:** `vault-writeback.sh` stores `base64.b64encode(raw).decode()` in leaf `data`
fields, and computes `size = len(base64_data)` to match the MacBook's format.

### 3. nginx / Tailscale Race Condition on Boot
nginx failed to bind to the Tailscale IP at boot because `tailscaled` hadn't assigned
the IP yet. Fixed via systemd drop-in on nginx service.

## Playbook Used

`playbooks/obsidian-sync.yml` (deploys `obsidian-sync.py` and `vault-writeback.sh`)
`playbooks/nginx.yml` (systemd drop-in for Tailscale ordering)

## Architecture

```
MacBook Obsidian ←→ (LiveSync) ←→ CouchDB ←→ obsidian-sync.py → filesystem (non-OpenClaw)
                                           ↑
OpenClaw agent → /opt/vaults/obsidian/OpenClaw/ → vault-writeback.sh (inotifywait)
```

- `vault-writeback.sh`: watches `OpenClaw/` for CLOSE_WRITE events, pushes to CouchDB
  in LiveSync v2 format (base64 leaf data, lowercase note ID, `children` array)
- `obsidian-sync.py`: watches CouchDB `_changes` feed, writes to filesystem, **skips**
  `OpenClaw/` to prevent sync loop
- Hash algorithm: SHA-256(raw_bytes), first 8 bytes → big-endian uint64 → base36, `h:` prefix

## Recovery Steps (if files get corrupted again)

1. Stop both services: `sudo systemctl stop obsidian-sync obsidian-vault-writeback`
2. If files on disk have base64 content, iteratively decode:
   ```python
   import base64
   content = open(f).read()
   while '\n' not in content[:200]:
       content = base64.b64decode(content).decode('utf-8', 'replace')
   open(f, 'w').write(content)
   ```
3. Delete all `openclaw/` note docs from CouchDB (tombstones cleared by restart)
4. Start `obsidian-vault-writeback` and trigger writes to re-push:
   ```bash
   echo "$(cat file)" | sudo tee file > /dev/null
   ```
5. Start `obsidian-sync`

## Verification Steps

1. Check services running: `systemctl status obsidian-sync obsidian-vault-writeback`
2. Check leaf content in CouchDB:
   ```bash
   curl -s 'http://obsidian_admin:PASS@localhost:5984/obsidian/_all_docs?include_docs=true' | \
     python3 -c "..."  # see verification query in ops notes
   ```
3. Verify files on disk are plain text: `head -3 /opt/vaults/obsidian/OpenClaw/README.md`
4. Ask user to check OpenClaw notes appear in Obsidian as readable markdown

## Rollback

- Remove SKIP_PATHS: edit `templates/obsidian-sync.py.j2` and redeploy
- Note: this would re-enable the sync loop — only rollback if vault-writeback is also stopped
