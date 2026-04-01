## Task
Set up CockroachDB, MinIO, and Datomic Transactor as Docker Compose services.
- CockroachDB: single-node, insecure mode, SQL on port 26257, UI on port 8090
- MinIO: API on port 9000, console on port 9001
- Datomic Transactor: port 4334, using CockroachDB as SQL storage backend
- All services share the `homelab-net` Docker network

## Playbook Used
`playbooks/docker.yml`

## Prerequisites
- Set `DATOMIC_LICENSE_KEY` env var before running
- Set `MINIO_ROOT_PASSWORD` env var (defaults to `changeme` if unset)
- Authenticate to the Datomic container registry if using the official image:
  `docker login ghcr.io` with Datomic credentials
- Alternatively, set `datomic_image` var to a locally built image

## Verification Steps
1. CockroachDB SQL: `docker exec cockroachdb cockroach sql --insecure -e "SHOW DATABASES"`
2. CockroachDB UI: browse to `http://<host>:8090`
3. MinIO console: browse to `http://<host>:9001` (login: minioadmin / $MINIO_ROOT_PASSWORD)
4. MinIO API: `curl http://localhost:9000/minio/health/live`
5. Datomic transactor: `docker logs datomic-transactor` (look for "System started")
6. All containers: `docker ps --format "table {{.Names}}\t{{.Status}}"`

## Rollback
```bash
# Stop individual services
docker compose -f /opt/compose/datomic/docker-compose.yml down
docker compose -f /opt/compose/minio/docker-compose.yml down
docker compose -f /opt/compose/cockroachdb/docker-compose.yml down

# Remove data volumes (destructive!)
docker volume rm cockroachdb_cockroach-data minio_minio-data datomic_datomic-data

# Remove network
docker network rm homelab-net

# Remove UFW rules
sudo ufw delete allow 26257/tcp
sudo ufw delete allow 8090/tcp
sudo ufw delete allow 9000/tcp
sudo ufw delete allow 9001/tcp
sudo ufw delete allow 4334/tcp
```
