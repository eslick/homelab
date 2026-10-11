# Consolidate playbooks into per-subsystem state files

## Task
Make `playbooks/` equal the aggregate of every dated change, and keep the dated history only in `runbooks/`. A full `--check --diff` of every live playbook found drift and non-idempotent tasks (fixed first), then the monoliths and one-shots were reorganised.

## Playbook Used
- Drift fixes (commit "remove drift and non-idempotent tasks"): `system.yml` (GitHub-CLI key `force: no`, Clojure download guarded, arcana2 `settings.local.json` now renders the browser token with `no_log` so applying it no longer deletes the hand-added token), `gpu.yml` (keyring download `check_mode: false`), `syncthing.yml` (recursive mode `u=rwX,g=rX,o=rX` instead of 0755 on every note), `docker.yml --tags curl-image` (applied: removed stray `curlimages/curl` image; its only `become` task).
- Restructure: `system.yml` split into `base.yml`, `tailscale.yml` (+ former `tailscale-serve.yml`), `devtools.yml` (+ former `elixir-dev.yml`), `claude.yml`, `monitoring.yml` (+ former `claude-health-cron.yml`); `nas.yml` renamed `storage.yml`; two redundant postfix tasks dropped (postfix.yml owns them); new `site.yml` imports all in dependency order. `retire-*`, `remove-openclaw`, `lvm-extend` moved to `archive/`; `vllm.yml` to `optional/` (conflicts with SGLang for the GPU: applying it would start a second GPU server); `system-upgrade.yml` to `ops/`. No task bodies were rewritten in the split; 48 tasks in, 48 out (46 kept + 2 duplicates dropped, handlers moved with their play).
- `CLAUDE.md` (repository model + change workflow: edit subsystem file, apply, dated runbook, commit and push every time), `README.md` (layout, rebuild step 4 = `site.yml`, manual-step list), `Makefile` (`make drift`; removed targets pointing at the nonexistent `upgrade-arcana.yml`).

## Verification Steps
1. `ansible-playbook playbooks/site.yml --syntax-check`.
2. `make drift`: 0 failed; 4 "changed", all dry-run artefacts (`get_url` apt keys for GitHub CLI and Syncthing, compose `build` for MinIO and Arcana 2); 2 ignored fatals are the pre-existing `ignore_errors` tasks (systemd-timesyncd absent, vLLM project absent).
3. Only real change applied to the system was the curl image removal.

## Rollback
`git revert` the commits. Nothing was applied from the new files except the curl-image task, so the host is unaffected. Known gap: runbooks before this date name old playbook filenames (`system.yml`, `nas.yml`, ...); the map is in this file and the README.
