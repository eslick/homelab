# YugabyteDB Dev Instance for Arcana

## Task
Stand up a single-node YugabyteDB dev instance on the homelab and point Arcana at it instead of CockroachDB. CockroachDB remains for Datomic.

## Playbook Used
`playbooks/docker.yml` — tags `docker,arcana`

## What Changed
- New service: `yugabytedb` container via `templates/yugabytedb-compose.yml.j2`
  - Image: `yugabytedb/yugabyte:latest`
  - YSQL port: 5433 (PostgreSQL wire protocol)
  - Master UI: http://speedracer.terrier-haddock.ts.net:7000
  - Auth disabled via `--tserver_flags=ysql_enable_auth=false`
  - Data volume: `yugabyte-data:/root/var` (default yugabyted data dir)
- `agent_os_dev` database created in YugabyteDB
- Arcana `DATABASE_URL` updated: `postgresql://yugabyte@yugabytedb:5433/agent_os_dev`

## Quirks Discovered
- `ysqlsh` inside the container does NOT connect via `localhost` — YugabyteDB binds to the container hostname (`yugabytedb`). Always use `-h yugabytedb` flag.
- Default data dir is `/root/var`, not `/home/yugabyte/var`.
- Startup takes ~2 minutes; the Ansible wait task uses 20 retries × 5s.
- YugabyteDB version: PostgreSQL 15.12-YB-2025.2.3.0

## Verification Steps
```bash
# Check container is running
docker ps | grep yugabytedb

# Verify YSQL connectivity and agent_os_dev exists
docker exec yugabytedb ysqlsh -h yugabytedb -U yugabyte -c "\l"

# Check yugabyted status
docker exec yugabytedb /home/yugabyte/bin/yugabyted status
```

## Rollback
```bash
# Revert Arcana DATABASE_URL back to CockroachDB
# Edit templates/arcana-compose.yml.j2:
#   DATABASE_URL: "postgresql://root@cockroachdb:26257/agent_os_dev?sslmode=disable"
# Then re-run arcana tasks:
ansible-playbook playbooks/docker.yml --tags arcana

# Stop and remove YugabyteDB (data volume preserved)
docker compose -f /opt/compose/yugabytedb/docker-compose.yml down
```
