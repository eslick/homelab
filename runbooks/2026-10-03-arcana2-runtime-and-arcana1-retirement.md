## Task

1. Finalize the CockroachDB v26.2 upgrade.
2. Stand up Arcana 2 as an Ansible-managed service (per `~/projects/arcana2/docs/handoff/homelab-arcana2.md`), backed by CockroachDB, and make it the Arcana in use.
3. Archive, then remove, Arcana v1 (and its nginx vhost).

## Playbook Used

- `playbooks/cockroachdb-upgrade.yml --tags finalize` — cluster version now `26.2`; `preserve_downgrade_option` cleared (irreversible).
- `playbooks/arcana2.yml` (new) + `templates/arcana2-compose.yml.j2` — compose at `/opt/compose/arcana2/` (project name kept as `arcana-dev` so the named volumes were reused); `arcana_dev` database created in CockroachDB; `ANTHROPIC_API_KEY` from the Ansible vault (`vault_anthropic_api_key`) into root-only `/opt/secrets/arcana2.env` (0600); joins `homelab-net`; talks to `postgres://root@cockroachdb:26257/arcana_dev?sslmode=disable`.
- `playbooks/nginx.yml` + `templates/arcana2-nginx.conf.j2` — Tailscale TLS vhost `:14000` -> `127.0.0.1:4100` (WebSocket upgrade for LiveView); services-index entry "Arcana 2". Also removed the stale pre-rename `agentos` vhost that still claimed :14000 and pointed at dead v1 port 14100.
- `playbooks/system.yml --tags configure,claude` — `/usr/local/bin/arcana2dev` wrapper (same pattern as `homedev`), `~/projects/arcana2/.claude/settings.local.json` (model `claude-sonnet-5-5`), plus a local-only `.git/info/exclude` entry so the arcana2 checkout's `git status` stays clean.
- `playbooks/retire-arcana-v1.yml` (new): `--tags archive` then `--tags remove`.
- `playbooks/docker.yml`: removed the Arcana v1 section, vars and service entry. Deleted `playbooks/upgrade-arcana.yml`, `templates/arcana-compose.yml.j2`, `templates/arcana-nginx.conf.j2` (kept in git history).

Deviations from the handoff doc (deliberate):
- Port is published on `127.0.0.1:4100` and fronted by nginx on `https://speedracer.terrier-haddock.ts.net:14000/`, not `100.74.60.51:4100` (homelab convention: loopback-only ports, nginx is the sole Tailscale ingress).
- Checkout stays at `~/projects/arcana2` (not moved under `~/homelab/projects/`), matching `homedev`, and avoiding disturbing the live bind mount and parallel work. Variable: `arcana2_src_path`.
- `make dev.up/dev.down` in the arcana2 repo use its own `docker/compose.dev.yml` (Yugabyte URL, different bind). Do not use them now: they would fight the Ansible-managed container. Use `ansible-playbook playbooks/arcana2.yml` (add `-e arcana2_rebuild=true` after `Dockerfile.dev`/`mix.exs` changes).

### v1 archive
`/mnt/nas/backups/archives/arcana-v1/` (outside the restic repo): `arcana-v1-2026-10-03.tar.gz` (working tree incl. uncommitted changes; `deps`/`_build` excluded), `arcana-v1-2026-10-03.bundle` (full git history), `SHA256SUMS`. Verified before deletion: checksums, tar contents incl. modified `docker-compose.yml`, bundle HEAD `1bfb82d` equals live HEAD. The Yugabyte volume (`agent_os_dev` etc.) was left untouched. The `artifacts` bucket in MinIO was left in place (only its creation task was removed).

## Verification Steps

```
docker ps --filter name=arcana-dev                          # Up, 127.0.0.1:4100->4100
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4100/          # 200
curl -s -o /dev/null -w '%{http_code}' --resolve speedracer.terrier-haddock.ts.net:14000:100.74.60.51 https://speedracer.terrier-haddock.ts.net:14000/   # 200
docker exec arcana-dev bash scripts/setup.sh --check        # toolchain present
docker exec arcana-dev env MIX_ENV=test make check          # 1040 tests, see findings
ansible-playbook playbooks/arcana2.yml                      # changed=0 (idempotent)
```
Live reload verified: edit of `lib/arcana.ex` reflected in the running node in ~3 s (reverted).

## Findings handed back to the arcana2 repo (not changed here)

1. **Cockroach migration incompatibility (handoff item 3.3):** the first migration (`20260522000000_create_model_store`) fails with `unimplemented: arrays of JSON unsupported as column type` (CockroachDB #23468). Repo-backed subsystems cannot boot until arcana2 is adapted; this needs the user's sign-off per arcana2 `CLAUDE.md`. `mix test.db` / `make dev.migrate` verification was therefore not run.
2. **`jq` missing from the `arcana-dev` image:** 4 tests in `test/arcana/lib/mcp/transport_stdio_test.exs` fail (`jq: not found`). Fix: add `jq` to `docker/Dockerfile.dev`, then rebuild (`-e arcana2_rebuild=true`). `make check` otherwise ran 1040 tests; 6 failures on the first run, 4 reproduced (jq), 2 did not reproduce on rerun (not diagnosed).
3. Not run: `make lean.build` / F* builds and the Linux-vs-committed determinism check (long-running, unrelated to the runtime wiring).

## Notes

- Left in place: `~/homelab/projects/agentos` and `/opt/compose/agentos` (appear to be an older incarnation of Arcana v1) — not touched; candidates for the same archive-and-remove treatment.
- Yugabyte vhost (:7001) still returns 502 and UFW 5433 allow still exists while Yugabyte is disabled.
- Homedev's web UI (:3000, behind :3001) is not listening: only its nREPL starts on boot (unrelated to this change).
- `/opt/secrets` is not in the restic path set; the arcana2 env file is regenerated from the vault by the playbook.
- A root-owned scratch dir from the bundle-clone check remains under the session scratchpad.

## Rollback

- Arcana 2: `docker compose -p arcana-dev -f /opt/compose/arcana2/docker-compose.yml down` (volumes kept), remove `/opt/compose/arcana2`, `/opt/secrets/arcana2.env`, the `arcana2` nginx site; `DROP DATABASE arcana_dev` if desired.
- Arcana v1: extract `/mnt/nas/backups/archives/arcana-v1/arcana-v1-2026-10-03.tar.gz` into `~/homelab/projects/` (or clone the `.bundle`), then `git revert` this commit to restore the v1 playbooks/templates.
- CockroachDB finalize cannot be rolled back; restore from restic if required.
