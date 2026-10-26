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

## Addendum: QTS web UI refuses the tailnet IP (port forward workaround)
- Symptom: iPhone QuMagie said "cannot connect to the network". TCP to `100.100.170.39:8080` (and `:8443`) connected and was then reset. SMB 445, SSH 22 and Plex 32400 worked fine over the tailnet.
- Findings: the same request works to `127.0.0.1:8080` and `192.168.50.101:8080`, and also fails when the NAS itself connects to its own tailnet IP. So the QTS Apache proxy (backend `127.0.0.1:58080`) resets anything addressed to the tailnet IP. The firewall (`ts-input`) is not the cause. Root cause setting not found.
- Workaround (on the NAS, persists in tailscaled state): `tailscale serve --bg --tcp 18080 tcp://127.0.0.1:8080`. Use `http://100.100.170.39:18080` (QuMagie app: address `100.100.170.39`, port `18080`, SSL off). `/qumagie/` returns 200.
- Rollback: `tailscale serve --tcp=18080 off` (or `tailscale serve reset`) on the NAS.

## Addendum: switched to the signed App Center build (1.104.2 → 1.40.0)
- Symptom: Tailscale kept stopping on the NAS every ~20-25 min (log lines 19:10, 19:34, 19:54, 20:05, 20:06). `/var/log` showed
  `[App Center] Tailscale has an invalid digital signature. The app has stopped and cannot be installed on QTS.` followed by
  `Stopped Tailscale.`, and `Enable` in `/etc/config/qpkg.conf` flipped to FALSE. The NAS had not rebooted (153 days up).
- Cause: the pkgs.tailscale.com `.qpkg` is unsigned and QTS 5.2 App Center periodically revalidates and stops it. QNAP docs say App Center
  rejects invalid/tampered signatures even with "Allow installation without a digital signature" enabled, so that setting is not a reliable fix.
- Attempts that did not work: re-enabling by hand (stopped again within a minute); a temporary `/tmp` watchdog loop (kept it up, removed afterwards);
  running the signed `.qpkg` over SSH on top of the existing install (aborted with `Tailscale.sh: no such file` and left the install dir with
  unrelated Hybrid Backup files; cause not established, either that run or the cancelled GUI install).
- Fix: backed up `.qpkg/Tailscale/state` (`tar` over SSH), removed the app in App Center, installed Tailscale from the App Center store (signed, **1.40.0-1**, much
  older than the pkgs.tailscale.com build), then stopped the daemon, restored `state/` from the backup and restarted. Same node identity and IP (`100.100.170.39`), no re-login;
  the `tailscale serve --tcp 18080` forward came back with the state.
- Verification: survives a NAS reboot; `tailscale ping qnap-nas` pongs; `http://100.100.170.39:18080/qumagie/` returns 200; no signature errors logged after the install.
- Notes: the store build lags upstream. The QTS Tailscale app links to the MagicDNS name, which fails on hosts with `accept-dns=false` (this one); use the tailnet IP.
- Rollback: back up `state/` first, remove the app in App Center, reinstall; restore `state/` and restart `Tailscale.sh`.
