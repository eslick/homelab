## Task

Bring the host up to date (apt) and review key services (YugabyteDB, CockroachDB, MinIO, Home Assistant) for needed upgrades.

## Playbook Used

`playbooks/system-upgrade.yml` (no edits), applied without the reboot phase:

```
ansible-playbook playbooks/system-upgrade.yml --check --diff
ansible-playbook playbooks/system-upgrade.yml --skip-tags reboot
```

Pre-check: latest restic snapshot 2026-10-03 03:00. Upgraded: kernel 6.8.0-142 -> 6.8.0-146, gh 2.102.0, google-cloud-cli 587.0.0, thermald, linux-tools-common/libc-dev. NVIDIA 615.71.09 already current. 10 packages (mesa, dnsmasq-base, sosreport, alsa-ucm-conf) deferred by Ubuntu phasing — will arrive on their own.

**Reboot pending** (`/var/run/reboot-required`) to load kernel 146; not yet performed.

## Service review (no changes made)

| Service | Running | Newest upstream | Note |
|---|---|---|---|
| YugabyteDB | 2025.2.3.0-b149 | 2025.2.6.0-b111 (same stable series); 2026.1.2.0 is `latest` | Pin `yugabytedb_version`; patch-upgrade to 2025.2.6.0 |
| CockroachDB | v26.1.1 | v26.2.7 | Major-version upgrade; needs finalization planning |
| MinIO | RELEASE.2025-09-07 | not checked | Image tag is `latest`; community edition has had security-relevant changes, review before pulling |
| Home Assistant | 2026.9.4 | stable | Tracks `stable` |

All of yugabytedb/cockroachdb/minio use `:latest` when no `*_version` var is set, so a plain pull + recreate would jump yugabyte to 2026.1.x. Recommend pinning.

## Verification Steps

```
apt list --upgradable        # only phased packages remain
docker ps                    # all 8 containers Up
nvidia-smi                   # 615.71.09
docker exec yugabytedb bin/yugabyted status   # Running, YSQL Ready
```

## Rollback

Kernel: old 6.8.0-142 remains installed; select it from GRUB. Other packages: `apt install <pkg>=<old version>` (via playbook).
