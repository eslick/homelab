# Arcana nodes: BROWSER_SERVICE_URL

## Task
Arcana's screenshot client (`app_render_check`) reads `BROWSER_SERVICE_URL` and `BROWSER_SERVICE_TOKEN`. The token was already delivered via `/opt/secrets/arcana2.env`; the URL was missing, so the tool fell back to the structural check with `screenshot_error: :browser_service_unavailable`. Added the URL to the same env file (not secret, but it rides the existing `env_file` that `docker/compose.dev.yml` loads) instead of editing the arcana2 repo's compose file, then recreated both nodes.

## Playbook Used
`playbooks/arcana2.yml --tags secrets` (new entry `BROWSER_SERVICE_URL: "{{ browser_service_url_internal }}"` = `http://browser-service:8931`, from `vars/browser-service.yml`). Become-root tasks: secrets dir check, env file write (0600, owner eslick). Do not run this playbook without `--tags`: its compose template is a stale single-node variant of the cluster that `make dev.up` actually runs.
Nodes recreated with `make dev.up` in `~/projects/arcana2` (compose project `arcana-dev`; env is read only at container creation).

## Verification Steps
1. `docker exec arcana-dev printenv BROWSER_SERVICE_URL` (and `arcana-dev-2`) prints `http://browser-service:8931`; `printenv BROWSER_SERVICE_TOKEN | wc -c` is 49.
2. From inside `arcana-dev`: `curl $BROWSER_SERVICE_URL/healthz` returns `{"ok":true,...}`; `POST /mcp` without a token is 401; with the bearer token and `?profile=arcana` an MCP `initialize` returns 200.
3. `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4100/` is 200 after recreate.

## Rollback
Remove the `BROWSER_SERVICE_URL` line from `arcana2_provider_secrets`, run `ansible-playbook playbooks/arcana2.yml --tags secrets`, then `make dev.up` is not enough on its own: recreate with `docker compose -f docker/compose.dev.yml up -d --force-recreate` in the arcana2 repo so the nodes drop the variable.
