## Task

Post-reboot health check found `mdmonitor.service` in a `failed` state. Diagnosed and fixed. Also prepared (not yet applied) a system/CUDA driver upgrade playbook per user request.

## Diagnosis: mdmonitor.service

`journalctl -u mdmonitor` showed the service has failed on **every boot since at least 2026-04-27** (first tracked boot in journal):

```
mdadm[PID]: mdadm: No mail address or alert command - not monitoring.
systemd[1]: mdmonitor.service: Main process exited, code=exited, status=1/FAILURE
```

Root cause: `/etc/mdadm/mdadm.conf` had no `MAILADDR` (or `PROGRAM`) directive, so `mdadm --monitor --scan` refuses to start — it has nothing to alert with. This is a pre-existing config gap, not something introduced this session. The RAID5 array itself (`/dev/md0`) is healthy `[UUUU]` (4/4 disks) — see `runbooks/2026-04-27-raid5-reassembly.md`.

## Playbook Used

`playbooks/system.yml` — added task "Configure mdadm mail alert address" (`lineinfile` appending `MAILADDR root` to `/etc/mdadm/mdadm.conf`), with a `Restart mdmonitor` handler.

Applied with:
```
ansible-playbook playbooks/system.yml --tags raid,monitoring
```

## Verification Steps

```
systemctl status mdmonitor.service
# Active: active (running)
```

Postfix (already installed/running per `system.yml`) delivers local mail to root; `mail -u root` or `/var/mail/root` will receive future mdadm alerts (rebuild start/finish, disk failure, degraded array).

## Rollback

Remove the `MAILADDR root` line from `/etc/mdadm/mdadm.conf` and restart `mdmonitor.service`. No data or array-layout impact — this only affects alerting.

---

## Separate: CUDA driver upgrade plan (NOT YET APPLIED)

Added `playbooks/system-upgrade.yml` to handle the pending 78-package apt upgrade, split into:
1. General packages (`upgrade: safe`) — 60 packages, no removals beyond autoremoving `google-cloud-cli-anthoscli`.
2. NVIDIA/CUDA stack (`cuda-drivers`, `nvidia-driver`, `nvidia-dkms` → `state: latest`) — driver 595.71.05 → 615.71.09.
3. Reboot (`ansible.builtin.reboot`) + post-reboot verification (`nvidia-smi`, GPU passthrough into a throwaway container, `docker ps`).

**Dry run of the GPU task revealed the apt dependency resolver switches the driver package flavor**, not just the version:

- Removes: `nvidia-kernel-source` (proprietary)
- Installs new: `nvidia-open`, `nvidia-driver-open`, `nvidia-dkms-open`, `nvidia-kernel-source-open`

This is a switch from NVIDIA's proprietary kernel module to the **open-source GPU kernel modules**. Research (see conversation) confirms this is expected on the 615 branch — NVIDIA deprecated the proprietary flavor of the `cuda-drivers` meta-package starting around this release — and open kernel modules are GA-supported for Turing+ (RTX 3090 is Ampere, well within support). Not a red flag, but a real package-flavor transition that CLAUDE.md's "stop on unexpected diff" rule requires confirming with the user before applying.

**Status**: playbook and dry-run reviewed; holding the actual `ansible-playbook playbooks/system-upgrade.yml` run (which reboots the host) for explicit go-ahead.

No GPU inference container was running at diagnosis time (`sglang-watcher` lazily starts `sglang` on demand; `vllm` not currently deployed), so the reboot window has no active inference workload to drain.
