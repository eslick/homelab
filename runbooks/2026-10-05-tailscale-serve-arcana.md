# Tailscale serve for Arcana 2 (mobile web push)

## Task
Mobile browsers need a trusted HTTPS origin for web push. nginx's tailnet :443 and :4100 use a
self-managed cert, and :443 hosts the landing page. Expose Arcana (127.0.0.1:4100) through
`tailscale serve` on :8443 so it gets a Let's Encrypt cert.
URL: https://speedracer.terrier-haddock.ts.net:8443 (tailnet only)

## Playbook Used
`playbooks/tailscale-serve.yml` (tags: configure, tailscale). Replaces the manual
`sudo tailscale serve --bg --https=443 http://127.0.0.1:4100`, which would have collided with nginx on :443.
`become: yes` tasks: read serve status, configure serve, remove serve (only when state=absent).

## Verification Steps
- `sudo tailscale serve status` shows `:8443 -> proxy http://127.0.0.1:4100`
- Re-running the playbook skips the configure task (idempotent)
- `curl --resolve speedracer.terrier-haddock.ts.net:8443:100.74.60.51 https://speedracer.terrier-haddock.ts.net:8443/`
  returns 200 with ssl_verify_result 0 (the host has --accept-dns=false, so pin the IP)
- From a phone on the tailnet, open the URL and confirm the cert is trusted

## Rollback
`ansible-playbook playbooks/tailscale-serve.yml -e tailscale_serve_state=absent`
