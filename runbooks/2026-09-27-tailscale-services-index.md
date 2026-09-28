# Tailscale Services Index Page

## Task
Add a simple static HTML landing page, served by nginx over Tailscale,
listing all services reachable via the Tailscale DNS namespace — so
`http://speedracer.terrier-haddock.ts.net/` gives a quick index instead
of needing to remember each service's port.

## Playbook Used
`playbooks/nginx.yml` (added index-page tasks), rendering:
- `templates/tailscale-index.html.j2` → `/var/www/tailscale-index/index.html`
- `templates/tailscale-index-nginx.conf.j2` → `/etc/nginx/sites-available/tailscale-index`

Key decisions:
- Listens on `{{ tailscale_ip }}:80`, plain HTTP (not HTTPS) — Tailscale
  traffic is already encrypted end-to-end via WireGuard, and this page
  has no backend/proxy_pass, just static files, so TLS termination adds
  nothing here. Every other vhost (`homeassistant`, `arcana`, `vllm`) is
  HTTPS because they proxy real backends with cookies/auth.
- Port 80 was free (confirmed nothing listened there beforehand) and is
  the natural default for a landing page — no port number needed in the
  URL.
- Service list lives in `playbooks/nginx.yml`'s `tailscale_services` var
  (name/port/description per entry); the template just loops over it.
  Adding a future service means adding one list entry, not hand-editing
  HTML.
- UFW: `80/tcp` allowed on `tailscale0` only, matching the pattern used
  for the other vhost ports.

Apply command used:
```
ansible-playbook playbooks/nginx.yml --check --diff --tags index   # dry run
ansible-playbook playbooks/nginx.yml --tags index                  # apply
```

## Verification Steps
1. `sudo nginx -t` → syntax OK.
2. `curl -s http://100.74.60.51:80/ -H "Host: speedracer.terrier-haddock.ts.net"`
   → page HTML returned, `200`.
3. `sudo ufw status | grep 80` → `80/tcp on tailscale0 ALLOW` only (not
   opened on the LAN or Docker bridge).

## Current contents
Links to the three services currently exposed via Tailscale nginx vhosts:
- Home Assistant — :8124
- Arcana — :14000 (returns 502 right now; Arcana isn't currently
  deployed — see `runbooks/` history. The link is still listed since the
  vhost and port are provisioned; it'll work once Arcana is redeployed.)
- vLLM / SGLang inference — :8082 (lazy-loads on first request, so an
  initial hit can be slow)

Deliberately not included: CockroachDB's admin UI (`:8090`) is exposed
UFW-wide (`ALLOW Anywhere`, not scoped to Tailscale) rather than through
this nginx pattern — that's pre-existing state, out of scope here, but
worth revisiting separately. Syncthing's GUI is bound to `127.0.0.1:8384`
only (no Tailscale exposure at all currently).

## Rollback
```
sudo rm /etc/nginx/sites-enabled/tailscale-index /etc/nginx/sites-available/tailscale-index
sudo rm -rf /var/www/tailscale-index
sudo systemctl reload nginx
sudo ufw delete allow in on tailscale0 to any port 80 proto tcp
git revert cb38ba7
```
