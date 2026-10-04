## Task

Consolidate on YugabyteDB as the single SQL database, and uninstall CockroachDB and Datomic. Decision (user): stick with Arcana's own data models and keep things simple; discarding past Datomic state is fine. Arcana 2's docs, Repo and test suite target YSQL; its first migration also failed on Cockroach (`jsonb[]` unsupported).

## Playbook Used

Staged, each with a dry run and verification before the next:

1. `playbooks/docker.yml` — `yugabytedb_enabled: true`; YSQL now published on **127.0.0.1:5433 only** (it has auth disabled; previously it was on all interfaces with a UFW allow-from-anywhere, which is removed and kept absent by a task); idempotent database creation (with retries for the cold-start race).
2. Datomic repointed to YSQL and **functionally tested** before removal: create database, 200 transactions from 8 concurrent writers, transactor restart, post-restart write, delete database — all passed. (Datomic on YSQL is not an officially supported combination.) Datomic was then uninstalled by decision, not because it failed.
3. homedev and Arcana 2 repointed at YugabyteDB (`templates/homedev-compose.yml.j2`, `playbooks/arcana2.yml`). Arcana 2: "migrations at head"; `mix test.db` = 370 tests, 0 failures; `make check` = 1040 tests, 0 failures.
4. `playbooks/retire-cockroachdb.yml --tags remove` — container, volume `cockroachdb_cockroach-data` (3.2 GB, mostly heartbeat churn), images, `/opt/compose/cockroachdb`, nginx admin-UI site, UFW rules 26257/8090/8091.
5. `playbooks/retire-datomic.yml --tags remove` — container, volume, image, `/opt/compose/datomic`, UFW 4334, and `DROP DATABASE datomic` in YugabyteDB.
6. Cleanup: removed Cockroach and Datomic from `docker.yml`/`nginx.yml`, deleted their templates and `cockroachdb-upgrade.yml`; fixed `power.yml` comment. Full re-apply of `docker.yml`, `nginx.yml`, `arcana2.yml`, `system.yml`; all are idempotent on a second pass.
7. Bug found and fixed: `yugabytedb_enabled` is duplicated in `nginx.yml` and was left `false`, which removed the Tailscale UFW rule for the Yugabyte UI (:7001). Keep the two copies in sync.

Pre-checks: restic snapshot of 2026-10-03 03:00 covers `/var/lib/docker/volumes`. Contents verified before removal: Cockroach `datomic_kvs` held only the transactor's `pod-coord` / `pod-standby` rows, `homedev` had no tables, `arcana_dev` only `schema_migrations`. Only remaining Cockroach clients were two idle `cockroachdb-claude-plugin` sessions (the Claude Code plugin on the host).

## Verification Steps

```
docker ps                                            # arcana-dev, homedev, yugabytedb, minio, homeassistant, sglang(-watcher)
ss -ltn | grep -E ':(5433|7000)\b'                   # both on 127.0.0.1 only
sudo ufw status | grep -E '26257|8090|8091|4334|5433'   # none (7000/127.0.0.1 and 7001/tailscale0 are expected)
docker exec yugabytedb bin/yugabyted status          # Running / YSQL Ready
docker exec yugabytedb ysqlsh -h yugabytedb -U yugabyte -tAc "select datname from pg_database"
curl -s -o /dev/null -w '%{http_code}' --resolve speedracer.terrier-haddock.ts.net:14000:100.74.60.51 https://speedracer.terrier-haddock.ts.net:14000/   # 200
for p in docker nginx arcana2; do ansible-playbook playbooks/$p.yml; done   # idempotent (docker.yml reports 1 always-changed image build)
```

## Rollback

- Cockroach/Datomic: `git revert` the commits that deleted their templates/tasks and re-run `docker.yml`; data would have to be restored from restic (the volumes `cockroachdb_cockroach-data`, `datomic_datomic-data` are in snapshots until retention expires, up to ~12 months). Nothing of value was in either.
- YugabyteDB loopback binding: revert the port line in `templates/yugabytedb-compose.yml.j2`. Do not reopen 5433 in UFW while auth is disabled.

## Notes / follow-ups

- The Claude Code `cockroachdb` plugin (MCP toolbox) still points at the removed instance and will error; disable it in the user's Claude plugin settings (not managed here). The `toolbox` binary installed by `system.yml` (tag `cockroachdb`) was left in place.
- homedev still reads `CRDB_URL` (name kept; value now YugabyteDB). Its `resources/config.edn` default still names the old Cockroach URL; update it in the homedev repo.
- Arcana 2's boot log prints dependency advisories (Bandit, Mint, Phoenix); worth a `mix deps.update` in the arcana2 repo.
- `docker/Dockerfile.dev` in the arcana2 checkout has an uncommitted `jq` addition.
