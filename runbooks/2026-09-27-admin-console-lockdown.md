# Lock Down Admin Consoles + Add to Tailscale Index

## Task
Add links to the admin consoles for MinIO, CockroachDB, and YugabyteDB on
the Tailscale services index page (`runbooks/2026-09-27-tailscale-services-index.md`).

Before adding links, discovered these consoles were bound `0.0.0.0` and
allowed through UFW from `Anywhere` — reachable from the entire internet,
not just Tailscale, violating the standing "nginx is sole Tailscale
ingress / everything else 127.0.0.1-bound" architecture rule. User chose
to lock these down (not just add links to the exposed ports) as part of
this task. Their data ports (26257 SQL, 5433 YSQL, 9000 S3 API) were left
as-is — a separate, larger decision since other tools may connect to
them directly.

## Playbooks Used
- `playbooks/docker.yml`: rebind console ports to loopback, replace the
  blanket UFW allow with a scoped one.
- `playbooks/nginx.yml`: add TLS vhosts for each console + index entries.
- Templates: `cockroachdb-compose.yml.j2`, `minio-compose.yml.j2`,
  `yugabytedb-compose.yml.j2` (port binding), and three new
  `<service>-nginx.conf.j2` files.

### Port changes
| Service | Console port (127.0.0.1 only) | New Tailscale nginx port |
|---|---|---|
| CockroachDB | 8090 | 8091 |
| MinIO | 9001 | 9002 |
| YugabyteDB | 7000 | 7001 |

`docker.yml`'s `services[].ports` list (which blanket-allows through UFW)
no longer includes these three ports; a new `admin_console_ports` var +
two tasks remove the old `Anywhere` UFW rule and add a `127.0.0.1`-only
one instead, matching how `arcana`/`vllm` are handled.

## Issue hit: recreating YugabyteDB broke it
Changing YugabyteDB's port mapping forced Docker Compose to recreate the
container (not just restart it in place) for the first time since it was
originally created months ago. This surfaced a latent, unrelated bug:

**Root cause:** `yugabyted` persists its RPC advertise address
(`advertise_address` in `.storage`-equivalent `conf/yugabyted.conf`, AND
in its own Raft-replicated master/tablet-server catalog — editing the
JSON file alone did not fix it) keyed to the container's hostname at
first bootstrap. The compose file never set an explicit `hostname:`, so
Docker defaulted it to the container's short ID (`0121ceda213f`). That ID
is stable across a simple `restart`, but changes on every `recreate` —
which is exactly what a compose config change (like a port edit)
triggers. On recreation, the new container got a new random hostname,
and the persisted catalog's stale reference to `0121ceda213f` could no
longer resolve, breaking YSQL entirely (`Resolve failed 0121ceda213f:
Host not found`).

**Fix:** pinned `hostname: "0121ceda213f"` explicitly in
`templates/yugabytedb-compose.yml.j2` (var `yugabytedb_hostname` in
`docker.yml`) — i.e., made the container's Docker hostname permanently
match what the already-bootstrapped database catalog expects, rather
than trying to migrate the catalog's internal metadata. This is
future-proof: any later recreation now keeps the same hostname.

**Verified recovered:** `YSQL Status: Ready`, `agent_os_dev` (Arcana's
database) intact, zero DNS resolution errors in fresh logs.

## Issue hit: unrelated broken `homedev` service blocked the full playbook run
While applying, `playbooks/docker.yml` and `playbooks/nginx.yml` had
picked up uncommitted, in-progress `homedev` (Clojure orchestrator)
additions from another editing session on this box. Its
`templates/homedev-compose.yml.j2` references `{{ vault_minio_root_user
}}`, which is undefined — this fails `docker.yml`'s "Deploy compose
files from templates" task (a single loop over all services) and halts
the whole play before reaching later tasks like "Start MinIO".

**Not fixed here** — the correct value isn't known, and it's someone
else's in-progress work. Routed around it instead: applied the
already-correctly-rendered CockroachDB/YugabyteDB compose changes and
the MinIO recreate directly via the same Ansible modules
(`ansible.builtin.template`, `community.docker.docker_compose_v2`) the
playbook itself uses, so the actual system state matches exactly what a
successful playbook run would produce.

**Flag for whoever owns `homedev`:** `vault_minio_root_user` needs to be
defined (likely in vault-encrypted `group_vars`, matching the pattern
`vault_anthropic_api_key`/`vault_openai_api_key` already use) before
`ansible-playbook playbooks/docker.yml` (no tags) will run cleanly again.

## Commit hygiene note
`docker.yml` and `nginx.yml` had my changes interleaved with the
uncommitted `homedev` additions in the same files (which predate this
task and aren't mine). To avoid bundling someone else's in-progress,
partially-broken work into my commits: reconstructed a "mine-only"
version of each file (last commit + only my hunks), committed that, then
restored the full working-tree file (mine + homedev) afterward so their
uncommitted work was left exactly as it was, just now sitting on top of
my committed base instead of the old one. Verified via
`git diff <file> | grep homedev` showing zero hits in the committed diff.

## Verification Steps
1. `docker ps --format '...{{.Ports}}...'` → CockroachDB `127.0.0.1:8090`,
   MinIO `127.0.0.1:9001`, YugabyteDB `127.0.0.1:7000` (all no longer
   `0.0.0.0`).
2. `sudo ufw status | grep -E '8090|9001|7000'` → `ALLOW 127.0.0.1` only,
   no more `ALLOW Anywhere`.
3. `curl -sk https://100.74.60.51:{8091,9002,7001} -H "Host: ..."` → `200`
   for all three.
4. `sudo nginx -t` → syntax OK.
5. Index page (`http://speedracer.terrier-haddock.ts.net/`) lists all
   three new consoles.
6. YugabyteDB: `docker exec yugabytedb ysqlsh -h yugabytedb -U yugabyte -c
   "SELECT 1"` → `1 row`; `\l` shows `agent_os_dev` intact.

## Rollback
```
# nginx vhosts
sudo rm /etc/nginx/sites-enabled/{cockroachdb,minio,yugabytedb}
sudo rm /etc/nginx/sites-available/{cockroachdb,minio,yugabytedb}
sudo systemctl reload nginx
sudo ufw delete allow in on tailscale0 to any port 8091 proto tcp
sudo ufw delete allow in on tailscale0 to any port 9002 proto tcp
sudo ufw delete allow in on tailscale0 to any port 7001 proto tcp

# re-expose console ports globally (NOT recommended -- reverts the fix)
sudo ufw delete allow from 127.0.0.1 to any port 8090 proto tcp
sudo ufw allow 8090/tcp
# (repeat for 9001, 7000)

git revert 55ecebf abcfba4
```
The YugabyteDB `hostname:` pin should NOT be reverted independently of a
full rollback — removing it without also handling the catalog's
persisted reference will reintroduce the DNS resolution bug on the next
container recreation.
