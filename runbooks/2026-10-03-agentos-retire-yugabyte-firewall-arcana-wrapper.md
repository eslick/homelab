## Task

1. Archive and remove the pre-rename `agentos` deployment.
2. Drop firewall rules for the disabled YugabyteDB.
3. Rename the `arcana2dev` wrapper to `arcana`.
4. Fix the missing `jq` in the Arcana 2 dev image and re-run `make check`.

## Playbook Used

- `playbooks/retire-agentos.yml` (new): `--tags archive`, then `--tags remove` (tagged `never`; asserts the archive exists).
  - Archived only `/opt/compose/agentos/docker-compose.yml`, **credentials redacted** (the original embedded plaintext Anthropic/OpenAI/MinIO keys; the NAS is synced to S3). Result: `/mnt/nas/backups/archives/agentos/docker-compose-2026-10-03.redacted.yml`; a playbook task fails if any `sk-…` string remains.
  - Not archived (rebuildable / empty): `projects/agentos` (empty root-owned dirs), volumes `agentos_build|deps|node_modules`, image `agentos-dev:local`. The v1 source is in the `arcana-v1` archive.
  - Removed: `projects/agentos`, `/opt/compose/agentos`, the 3 volumes, the image. No containers were running from it.
- `playbooks/docker.yml --tags security`: Yugabyte ports (5433, 7000-from-localhost) are no longer re-added by the loops when `yugabytedb_enabled: false`, and a new task deletes the existing rules.
- `playbooks/nginx.yml --tags security,yugabytedb`: the 7001/tailscale0 rule is now managed by a dedicated task (`delete` when disabled). `yugabytedb_enabled` is duplicated in nginx.yml; keep it in sync with docker.yml.
- `playbooks/system.yml --tags configure,claude`: wrapper is now `/usr/local/bin/arcana` (old `arcana2dev` removed).
- `playbooks/arcana2.yml -e arcana2_rebuild=true`: rebuilt `arcana-dev:local` after adding `jq` to `docker/Dockerfile.dev` in the arcana2 checkout (**uncommitted there**; it is the arcana2 repo's file).

## Verification Steps

```
sudo ufw status numbered | grep -E '\b(5433|7000|7001)\b'   # none; the other 26 rules unchanged
docker volume ls | grep agentos; docker images | grep agentos   # none
ls /mnt/nas/backups/archives/agentos                             # redacted compose only
ls /usr/local/bin/arcana; ls /usr/local/bin/arcana2dev           # exists / gone
docker exec arcana-dev jq --version                              # jq-1.7
docker exec arcana-dev env MIX_ENV=test make check               # 1040 tests, 0 failures
curl -s -o /dev/null -w '%{http_code}' --resolve speedracer.terrier-haddock.ts.net:14000:100.74.60.51 https://speedracer.terrier-haddock.ts.net:14000/   # 200
```
Both firewall playbooks re-run with changed=0.

## Rollback

- Firewall: set `yugabytedb_enabled: true` in docker.yml and nginx.yml and re-run with `--tags security`.
- agentos: only the redacted compose survives; the volumes were caches and the image was a build of the archived v1 source. Recreate from the arcana-v1 archive if ever needed.
- Wrapper: revert the system.yml tasks and re-apply.
- jq: revert the one-word change in `docker/Dockerfile.dev` and rebuild.
