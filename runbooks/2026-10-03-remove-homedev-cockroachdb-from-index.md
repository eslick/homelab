# Remove Homedev and CockroachDB from the Tailscale services index

## Task
Drop the Homedev and CockroachDB Admin UI entries from the Tailscale services landing page, and remove the CockroachDB admin UI nginx vhost, port variables and UFW rule from `playbooks/nginx.yml`. The Homedev nginx vhost and UFW rule (:3001) are intentionally left in place; only its index listing is removed.

## Playbook Used
`playbooks/nginx.yml` (`--tags index` applied; full `--check --diff` reviewed first). Index page is rendered from `templates/tailscale-index.html.j2` using the `services` list in the playbook.

## Verification Steps
- `grep -ciE "homedev|cockroach" /var/www/tailscale-index/index.html` returns 0
- Load the index page over Tailscale and confirm neither entry is listed

## Rollback
Re-add the `Homedev` (port `{{ homedev_nginx_port }}`) and CockroachDB entries to the `services` list in `playbooks/nginx.yml` (see git history) and run `ansible-playbook playbooks/nginx.yml --tags index`.
