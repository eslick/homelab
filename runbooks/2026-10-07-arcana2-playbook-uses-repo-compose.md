# arcana2.yml drives the repo's compose file

## Task
`playbooks/arcana2.yml` deployed a generated single-node compose copy (`templates/arcana2-compose.yml.j2` -> `/opt/compose/arcana2/`), while the real two-node cluster (arcana-dev + arcana-dev-2, Corpus mount, cluster hosts) runs from `docker/compose.dev.yml` in the arcana2 repo via `make dev.up`. Running the playbook untagged would have started the stale node under the same container name. Made the repo file the single source of truth.

## Playbook Used
`playbooks/arcana2.yml` (full run). Changes:
- Removed the compose template and its deploy task; deleted `/opt/compose/arcana2/docker-compose.yml` (empty dir left behind).
- `docker_compose_v2` now uses `project_src: ~/projects/arcana2/docker`, `files: [compose.dev.yml]`, `env_files: [dev.env]`, project `arcana-dev`; no `become` (operator has docker access).
- New task keeps `ARCANA_BIND_IP=100.74.60.51` in `docker/dev.env` (lineinfile; VAPID line and mode 0600 untouched).
- Health waits for both consoles (:4100, :4101). Dropped unused cookie/database-url vars.
- CLAUDE.md notes the deliberate exception to the /opt/compose convention.
Become-root tasks: secrets dir/env file, removing the old compose copy.

## Verification Steps
1. Full run completes; container IDs and `StartedAt` for arcana-dev and arcana-dev-2 are identical before and after (no recreate).
2. `docker ps` shows both nodes, ports on 127.0.0.1 and 100.74.60.51 only.
3. `ansible-playbook playbooks/arcana2.yml --check --diff` shows no unexpected changes (the compose task reports "changed" in check mode; the real run does not recreate).

## Rollback
`git revert` the commit, restore `templates/arcana2-compose.yml.j2`, and run `ansible-playbook playbooks/arcana2.yml --tags configure`. Do not start the template's single node while the cluster is running (same container names).
