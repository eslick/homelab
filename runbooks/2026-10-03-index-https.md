# Services index page over HTTPS

## Task
Serve the Tailscale services index page over HTTPS (previously plain HTTP on :80).
Reuses the existing Tailscale-issued cert for `speedracer.terrier-haddock.ts.net`
(already trusted by browsers) rather than a self-signed cert.

## Playbook Used
`playbooks/nginx.yml --tags index` (template `templates/tailscale-index-nginx.conf.j2`).
- :443 ssl vhost serves the index; :80 now 301-redirects to https.
- UFW: allow 80 and 443 on tailscale0. The old "remove stale 443 rule" task was deleted.

## Verification Steps
- `sudo nginx -t`
- `curl -sI http://speedracer.terrier-haddock.ts.net/` → 301 to https
- `curl -sI https://speedracer.terrier-haddock.ts.net/` → 200 (no `-k` needed)
- `sudo ufw status | grep 443` → ALLOW on tailscale0

## Rollback
`git revert` this commit, then `ansible-playbook playbooks/nginx.yml --tags index`.
Then `sudo ufw delete allow in on tailscale0 to any port 443 proto tcp` (via a playbook task with `delete: yes`).
