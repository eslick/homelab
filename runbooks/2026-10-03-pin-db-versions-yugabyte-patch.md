## Task

Pin container image versions for YugabyteDB and CockroachDB (previously floating `:latest`), patch-upgrade YugabyteDB 2025.2.3.0 -> 2025.2.6.0, and plan the remaining upgrades (CockroachDB 26.2, MinIO).

## Playbook Used

`playbooks/docker.yml` — added `cockroachdb_version: "v26.1.1"` (no version change; matches running build) and `yugabytedb_version: "2025.2.6.0-b111"`.

```
ansible-playbook playbooks/docker.yml --check --diff --tags configure,service
ansible-playbook playbooks/docker.yml --tags configure,service
```

Pre-check: restic snapshot 2026-10-03 03:00 covers /var/lib/docker/volumes.

Note: the run failed at the *Arcana image build* (`Unknown repository "fluxon"` during `mix deps.get`). Arcana was not running beforehand, so nothing regressed, but the `fluxon` hex repo needs to be configured for the Arcana build to work. Pre-existing, unrelated to this change.

## Verification Steps

```
docker ps                                   # yugabytedb 2025.2.6.0-b111, cockroachdb v26.1.1 Up
docker exec yugabytedb bin/ysqlsh -h 0121ceda213f -c 'select version()'   # PostgreSQL 15.12-YB-2025.2.6.0
docker exec yugabytedb bin/yugabyted status # Running / YSQL Ready
docker exec cockroachdb cockroach sql --insecure -e 'select count(*) from datomic.datomic_kvs'
```
Databases agent_os_dev etc. present; datomic_kvs intact.

## Remaining upgrade plans (not executed)

**CockroachDB v26.1.1 -> v26.2.x** (major). Take a restic snapshot and a `BACKUP`/volume copy, check `cluster.preserve_downgrade_option`, bump `cockroachdb_version`, apply, verify, then finalize (`RESET CLUSTER SETTING cluster.preserve_downgrade_option`). Single-node, so brief downtime; Datomic transactor will reconnect (restart it if not). Review release notes for 26.2 first.

**MinIO** (RELEASE.2025-09-07). Old release tags are no longer on Docker Hub (404), so it cannot be pinned by tag; it runs the locally cached `minio/minio:latest`. Do not `docker pull` blindly. Decide: build from source at a pinned tag, or move to a maintained fork/alternative image, then pin.

## Rollback

Revert the two vars in `playbooks/docker.yml` (or set `yugabytedb_version: "2025.2.3.0-b149"`) and re-run the playbook. Within a patch series the on-disk format is compatible; if not, restore the yugabyte-data volume from restic.
