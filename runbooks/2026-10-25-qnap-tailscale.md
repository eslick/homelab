# 2026-10-25 — Tailscale on the QNAP NAS

## Task
Join the QNAP NAS (`192.168.50.101`, QTS 5.2.9, x86_64) to the tailnet so the iPhone/Mac can reach it
(web UI, SMB, QuMagie, Plex) from anywhere. The NAS is a separate device that Ansible does not manage, so this was done by hand over SSH.

## Playbook Used
None. Manual install, because the NAS is outside this repo's Ansible scope. The rebuild steps are recorded in
README → "QNAP NAS on the tailnet".

Steps taken:
1. Created `~/.ssh/id_ed25519_qnap` (no passphrase, dedicated key) on this host, added `Host qnap` to `~/.ssh/config`, installed the public key for `admin` on the NAS with `ssh-copy-id` (the admin password was supplied by the user and was not stored).
2. Downloaded `Tailscale_1.104.2-1_x86_64.qpkg` from pkgs.tailscale.com, checked SHA-256 against the published `.sha256` (`38c46f58…eeef6`), streamed it to the NAS (`scp` is disabled there) and re-checked the hash on the NAS.
3. Ran the package installer as admin → `/share/CACHEDEV1_DATA/.qpkg/Tailscale/`; removed the staged file from `/tmp`.
4. `tailscale up --accept-dns=false --hostname=qnap-nas`, approved the login URL in the browser. No subnet routes advertised.

## Verification Steps
- `tailscale status` on this host lists `qnap-nas` (`100.100.170.39`).
- `tailscale ping qnap-nas` → pong via `192.168.50.101:41641` in 1 ms.
- NAS web UI port 8080 reachable at the tailnet IP (443 is closed, so QuMagie uses HTTP on 8080).
- On the NAS: `tailscaled` is running; QuMagie 2.10.0 is enabled.

## Rollback
- NAS UI: App Center → Tailscale → remove; or `tailscale logout` on the NAS first, then delete the machine in the Tailscale admin console.
- Remove the key: delete the `homelab->qnap` line from `~admin/.ssh/authorized_keys` on the NAS, then delete `~/.ssh/id_ed25519_qnap*` and the `Host qnap` block from `~/.ssh/config` here.

## Follow-ups
- Change the NAS admin password (it was shared in a chat session).
- Disable key expiry for `qnap-nas` in the Tailscale admin console.
