# Arcana overview page refresh (snapshot 2026-10-07)

## Task
`/arcana.html` was a snapshot of arcana2 at 7c1f6b55 (2026-10-04); the repo is 107+ commits further on. Refreshed the static views to arcana2 `main @ 37da38d9`:
- Layer diagram regenerated (agent runtime, Corpus, Reflect, Lib.Push, LLM backends and profiles, local SGLang external; apps marked designed-not-built).
- Subsystem dependency graph and table regenerated from `dependencies/0` (new: Corpus, Agent.Sessions, Agent.Residents; changed: Tasks, Code.Registry).
- New "Agent runtime" section: trigger -> session/resident -> harness -> tool gate -> approval, tool families, LLM profiles, assurance table.
- Summary tiles (28 boot subsystems, 382 source files, agent runtime, LLM profiles), dev-MCP tool list, runtime LLM row.
- `/overview.html`: sglang-watcher ports (host :8081 / net :8080) and the Anthropic box wording.
- Snapshot ref in `playbooks/nginx.yml` (`overview_arcana_ref`).

## Playbook Used
`playbooks/nginx.yml --tags overview` (dry run showed only overview.html and arcana.html changing). The layer and connection SVGs come from `scripts/gen-arcana-overview-svg.py` (module lists hard-coded; update them from DESIGN.md and `Arcana.Subsystems.integrated/0`, then run it against the template). The `docs/homelab/overview-*.html` fragments do not exist in the arcana2 repo yet, so those slots still show placeholders.

## Verification Steps
1. `curl -sk https://100.74.60.51/arcana.html | grep -c 'id="agents"'` returns 1 or more; page size ~54 KB.
2. Render check: the template was rendered with jinja2 and screenshotted with headless Chromium; all four SVGs parse as XML and the layers, connections and agent diagrams were inspected.
3. Open https://speedracer.terrier-haddock.ts.net/arcana.html from a tailnet device.

## Rollback
`git revert` the commit and re-run `ansible-playbook playbooks/nginx.yml --tags overview`.
