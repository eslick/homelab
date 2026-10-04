# Homelab overview dashboard

## Task
Add an at-a-glance dashboard page, linked from the Tailscale services index:
summary tiles, a configuration diagram (ingress → containers → host services → storage),
a home-network diagram, a Tailscale-access diagram (laptop and phone), a system hierarchy
tree, and an Arcana 2 section. Arcana's own internals are supplied by the Arcana session
through three optional HTML fragment files (contract in `docs/arcana-overview-contract.md`).

## Playbook Used
`playbooks/nginx.yml --tags overview` (also runs under `--tags index`).
- `templates/homelab-overview.html.j2` → `/var/www/tailscale-index/overview.html`
- `docs/arcana-overview-contract.md` → `/var/www/tailscale-index/arcana-overview-contract.txt`
- `templates/tailscale-index.html.j2`: new "Homelab overview" link at the top.
- Fragments read at deploy time from `{{ arcana_overview_dir }}` (`~/projects/arcana2/docs/homelab/`):
  `overview-summary.html`, `overview-hierarchy.html`, `overview-details.html`. Missing = placeholder.
- No nginx vhost or firewall change: the existing :443 vhost serves the files.

## Verification Steps
- `curl --resolve speedracer.terrier-haddock.ts.net:443:100.74.60.51 https://speedracer.terrier-haddock.ts.net/overview.html` → 200, no `{{`/`{%` in output
- `.../arcana-overview-contract.txt` → 200 text/plain; `/` contains a link to `/overview.html`
- Rendered in headless Chromium (desktop and 390 px width); fragment injection checked with sample
  fragments via `--check --diff -e arcana_overview_dir=<dir>`.
- Counts, disk usage and tailnet device status on the page are snapshots (`overview_snapshot_date`
  in nginx.yml); update them when the layout changes.

## Rollback
`git revert` this commit, then `ansible-playbook playbooks/nginx.yml --tags index`.
Remove the leftover files: `/var/www/tailscale-index/overview.html` and
`/var/www/tailscale-index/arcana-overview-contract.txt` (add `state: absent` tasks).
