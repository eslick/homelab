## Task

1. Upgrade CockroachDB v26.1.1 -> v26.2.7 (major; v26.2 is a Regular release, v26.1 was Innovation; direct path supported).
2. Disable YugabyteDB (container removed, installation kept).
3. Replace the unmaintained `minio/minio:latest` image with a source build of the newest upstream MinIO release.

## Playbook Used

- `playbooks/cockroachdb-upgrade.yml` (new): `--tags prepare` holds `cluster.preserve_downgrade_option='26.1'`; `--tags finalize` (tagged `never`) resets it.
- `playbooks/docker.yml`: `cockroachdb_version: v26.2.7`; `yugabytedb_enabled: false`; `minio_version: RELEASE.2025-10-15T17-29-55Z`; new tasks for the MinIO Dockerfile/build and a rollback image tag.
- `templates/minio-Dockerfile.j2` (new), `templates/minio-compose.yml.j2` (now builds locally).

Applied in three separate stages, verifying between each, always with `--skip-tags arcana` (arcana2 work is in flight and was deliberately not touched):
```
ansible-playbook playbooks/cockroachdb-upgrade.yml --tags prepare
ansible-playbook playbooks/docker.yml --check --diff --tags configure,service --skip-tags arcana
ansible-playbook playbooks/docker.yml --tags docker,configure,service --skip-tags arcana
```
Pre-check: restic snapshot 2026-10-03 03:00 covers the volumes.

### CockroachDB
Cluster version is **held at 26.1 (NOT finalized)**, so rollback to v26.1.1 is still possible. Finalize once satisfied:
`ansible-playbook playbooks/cockroachdb-upgrade.yml --tags finalize` (irreversible).
Datomic does **not** use YugabyteDB; its transactor stores data in CockroachDB (`datomic.datomic_kvs`) and reconnected after the restart.

### YugabyteDB
Container removed; kept: `yugabytedb_yugabyte-data` volume, `/opt/compose/yugabytedb/docker-compose.yml`, templates, nginx vhost (port 7001 now returns 502), UFW rule for 5433. Re-enable with `yugabytedb_enabled: true` and re-apply. Fixed a non-idempotency in the disable path (`state: absent` errors when nothing exists), so the task is guarded by a container-exists check.
Arcana (`arcana-dev`, in flux) depends on Yugabyte (`DATABASE_URL`) and the Arcana-tagged `Create agent_os_dev database in YugabyteDB` task; both left untouched, so a full unfiltered `docker.yml` run fails on that task until arcana2 repoints (the intent is CockroachDB/Datomic).

### MinIO
Upstream publishes source only; `minio/minio` is gone from Docker Hub. Built `RELEASE.2025-10-15T17-29-55Z` (fixes CVE-2025-62506) from the upstream tag on `golang:1.24`. Running version string shows a `DEVELOPMENT.` prefix (ldflags not marked release; cosmetic). Upstream is archived: there will be no newer releases, and the Chainguard image or a fork is the future path. `minio/mc` (used by bucket-creation tasks) is a cached local image and can no longer be re-pulled.

## Verification Steps

```
docker exec cockroachdb cockroach sql --insecure -e "select version(); show cluster setting cluster.preserve_downgrade_option; select count(*) from datomic.datomic_kvs"
docker logs datomic-transactor | tail      # "System started"
docker ps -a --filter name=yugabyte        # none; docker volume ls | grep yugabyte  # present
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9000/minio/health/ready   # 200
docker exec minio ls /data                 # artifacts homedev
```

## Rollback

- CockroachDB (before finalize): set `cockroachdb_version: v26.1.1`, apply `docker.yml`. After finalize: restore from restic.
- Yugabyte: `yugabytedb_enabled: true`, apply.
- MinIO: point the compose image at `minio-legacy:latest` (the preserved 2025-09-07 image; also still tagged `minio/minio:latest` locally) and drop the `build:` block; restore the volume from restic if needed.
