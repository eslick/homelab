# Headless browser service (Playwright/Chromium, REST + MCP)

## Task
Stand-alone, on-demand headless browser capability for (a) Arcana automation against websites, including
auto-login to personal sites, and (b) the Arcana Claude Code instance, via MCP, to debug Arcana's own UI.
Multiple concurrent isolated sessions; the service can be spun down entirely.

## Playbook Used
- `playbooks/browser-service.yml` (new): token env file (`/opt/secrets/browser-service.env`, 0600 eslick), site/profile
  definitions (`/opt/secrets/browser-sites.json`, 0400 uid 1001, vault-sourced, `no_log`), compose file from
  `templates/browser-service-compose.yml.j2`, build + start (`/opt/compose/browser-service`).
- `playbooks/nginx.yml --tags browser-service`: tailnet TLS vhost `:8931` (`templates/browser-service-nginx.conf.j2`) + UFW rule on `tailscale0`.
- `playbooks/arcana2.yml --tags secrets`: adds `BROWSER_SERVICE_TOKEN` to `/opt/secrets/arcana2.env`. Containers not touched.
- `vars/browser-service.yml` (new): shared port/URL vars and the token, generated once into `~/.ssh/browser-service-token` (not in git).
- Source: `projects/browser-service` (Node 24 + playwright-core 1.63, image `mcr.microsoft.com/playwright:v1.63.0-noble`; README there).
- Arcana-side instructions: `~/projects/arcana2/docs/handoff/homelab-browser-service.md`.

Design: one control-plane container; one Chromium process per session; REST for Arcana, MCP (Streamable HTTP, `/mcp`) for Claude,
both over one tool registry. Profiles = vault credentials + saved cookie state in the `browser-data` volume; callers never see credentials.
Guards: private/tailnet ranges blocked (except `arcana-dev`, `arcana-dev-2`), per-profile navigation allowlist, `evaluate` off for credentialed profiles,
audit log, non-root, `cap_drop: ALL`, 6 GB/4 CPU/1024 pids, max 4 sessions, loopback bind + nginx.

## Verification Steps
- `docker ps --filter name=browser-service` → healthy; `ss -ltn | grep 8931` → `127.0.0.1` and the tailnet IP (nginx) only.
- `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8931/v1/sessions` → 401; with `-H "Authorization: Bearer $(cat ~/.ssh/browser-service-token)"` → 200.
- Tailnet: `curl --resolve speedracer.terrier-haddock.ts.net:8931:100.74.60.51 https://speedracer.terrier-haddock.ts.net:8931/v1/sessions` → 401 / 200 with token.
- Session on profile `arcana`: `navigate http://arcana-dev:4100/` → title "Arcana Admin"; `http://yugabytedb:7000/` and `http://browser-service:8931/` → `ERR_BLOCKED_BY_CLIENT`.
- Smoke suite (fixture login site over REST + MCP): 12/12 (`projects/browser-service/README.md`, "Testing"). It was run in a throwaway `docker run --rm` container
  built from the same image before deployment (a deliberate exception to "no direct docker run": nothing persistent, no volumes, removed afterwards).
- `grep -c BROWSER /opt/secrets/arcana2.env` → 1.

## Update: human handoff, ordinary-browser identity, Perplexity profile (same day)
- Added `request_human`/`await_human`: Telegram message with a tailnet link to a CDP-screencast live view (`/live/<id>?t=<token>`, websocket through nginx, iframe-able from the Arcana console). Done saves cookies/localStorage into the profile.
- Browser identity normalised: no automation flags, Chrome UA without `HeadlessChrome`, America/Los_Angeles + en-US.
- `perplexity` profile (Google SSO, no stored credentials; `verify`: absent "Sign In" button, confirmed against the logged-out page, logged-in state not yet observed).
- nginx vhost now forwards websocket upgrades. UFW unchanged (same port).
- Telegram: bot token reuses `vault_telegram_bot_token`. **`vault_telegram_chat_id` is not created yet**: until it is, no message is sent and `request_human` returns the link to the caller.
- Verified: smoke suite 18/18 (incl. signing in through the live view with mouse, key and paste events); on the deployed service the screencast streams through the tailnet vhost and the Perplexity logged-out page loads without a block.
- Rollback for this change: `git revert` and re-run `browser-service.yml` and `nginx.yml --tags browser-service`.

## Add a personal site
1. `ansible-vault edit group_vars/all.yml`: add `vault_browser_<site>_user` / `_password` (/ `_totp`).
2. Add an entry to `browser_sites` in `playbooks/browser-service.yml` (template in the file; `verify` selector is mandatory).
3. `ansible-playbook playbooks/browser-service.yml --check --diff --tags sites`, then apply (restarts the container; saved logins persist).
4. Captcha/passkey/interactive 2FA: `scripts/capture-state.mjs` on a laptop uploads a hand-made login.

## Rollback
- Spin down only: `ansible-playbook playbooks/browser-service.yml -e browser_service_state=absent` (volume kept).
- Remove: `git revert` the commit; `docker volume rm browser-service_browser-data`; remove `/opt/compose/browser-service`, `/opt/secrets/browser-{service.env,sites.json}`,
  `/etc/nginx/sites-{available,enabled}/browser-service`, the UFW rule for 8931 on `tailscale0`; re-run `arcana2.yml --tags secrets` and `nginx.yml`.
- Rotate the token: delete `~/.ssh/browser-service-token`, re-run `browser-service.yml` and `arcana2.yml --tags secrets`, recreate the Arcana nodes.

## Known gaps
- Live view is a CDP screencast (no native popups/dropdowns/clipboard; popups follow as tabs); no captcha solving. Google may still refuse a headless browser even with a human typing: untested until the first real sign-in.
- Passkeys cannot be used (no authenticator in the headless browser).
- Shared single bearer token (no per-client scoping); one network guard at the application layer (no iptables egress policy).
- Not added to the tailnet index/overview pages.
