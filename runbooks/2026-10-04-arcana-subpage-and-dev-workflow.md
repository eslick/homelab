# Arcana sub-page, dev-workflow diagram, index reorder

## Task
Keep the homelab dashboard at homelab level and delegate subsystems to sub-pages:
- New `/arcana.html`: layered architecture (L0–L8), subsystem connection block diagram with a
  declared-dependency table, intent → proof → kernel pipeline, development and runtime notes, and
  slots for fragments written by the Arcana session.
- `/overview.html`: new "Arcana 2 development workflow" diagram (Claude Code + MCP) below the
  configuration diagram; Arcana section replaced by a Subsystems section linking out.
- Services index: Arcana 2 now sits directly under the overview card and above Home Assistant,
  with a "details →" link to `/arcana.html`.
- CSS shared via `templates/partials/overview-style.css`.

## Playbook Used
`playbooks/nginx.yml --tags overview` (also runs under `--tags index`):
`templates/arcana-overview.html.j2` → `/var/www/tailscale-index/arcana.html`,
`templates/homelab-overview.html.j2`, `templates/tailscale-index.html.j2`,
`docs/arcana-overview-contract.md` → `arcana-overview-contract.txt` (updated: fragments now render on /arcana.html).
New vars: `overview_arcana_ref`. No nginx vhost or firewall change.

## Verification Steps
- `curl --resolve speedracer.terrier-haddock.ts.net:443:100.74.60.51 https://speedracer.terrier-haddock.ts.net/{,overview.html,arcana.html,arcana-overview-contract.txt}` → 200 each
- Index lists Arcana 2 before Home Assistant with a details link.
- Rendered all diagrams in headless Chromium; fixed label overlaps.
- Layer map and dependency graph are derived from arcana2 `DESIGN.md`, `Subsystems.integrated/0` and each
  `dependencies/0` at the commit in `overview_arcana_ref`. Re-derive when the architecture changes.

## Rollback
`git revert` this commit, re-run `ansible-playbook playbooks/nginx.yml --tags index`, then remove
`/var/www/tailscale-index/arcana.html` (add a `state: absent` task).
