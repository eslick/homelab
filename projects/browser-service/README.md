# browser-service

Headless Chromium (Playwright) as a service: isolated browser **sessions** on demand, driven over
**REST** (for Arcana) or **MCP** (for Claude), with **profile-based auto-login** to personal sites.
Deployed by `playbooks/browser-service.yml`; this directory is the source (CLAUDE.md: locally
developed apps live in `projects/<name>`).

```
Arcana (HTTP client) ─┐                       ┌─ session A: chromium ─ context (profile "arcana")
Claude Code (MCP) ────┼─► browser-service ────┼─ session B: chromium ─ context (profile "github", logged in)
operator (REST/CLI) ──┘   :8931, bearer token └─ session C: chromium ─ context (ephemeral)
                          network guard · audit log · profile store (/data volume)
```

One Chromium process per session, so sessions are isolated and a crash only loses that session.
The service itself is cheap while idle (no browser runs until a session exists).

## Endpoints

| Where | URL |
|---|---|
| Containers on `homelab-net` (Arcana) | `http://browser-service:8931` |
| Host | `http://127.0.0.1:8931` |
| Tailnet (Mac, etc.) | `https://speedracer.terrier-haddock.ts.net:8931` |

All but `/healthz` need `Authorization: Bearer $BROWSER_SERVICE_TOKEN`
(host copy: `~/.ssh/browser-service-token`; in Arcana's env as `BROWSER_SERVICE_TOKEN`).

### REST
```
GET    /v1/tools                          tool names, descriptions, JSON schemas (feed these to an LLM)
GET    /v1/profiles                       profiles (no secrets): has_credentials, has_saved_state, allowed_hosts
PUT    /v1/profiles/:id/state             upload a Playwright storageState (see scripts/capture-state.mjs)
DELETE /v1/profiles/:id/state             forget the saved login
POST   /v1/sessions   {profile?, ttl_s?, label?, login?: true, persist?: true, viewport?: {width,height}}
GET    /v1/sessions[/:id]                 list / inspect
DELETE /v1/sessions/:id                   close (saves profile state)
POST   /v1/sessions/:id/tools/:name       body = tool arguments → {"content":[{"type":"text"|"image",...}]}
```
Errors are `{"error": "..."}` with 400 (bad args), 401, 404, 500 (tool failure, session cap).

### MCP
Streamable HTTP at `/mcp`. A browser session is created lazily on the first tool call and closed on
disconnect (clients that just drop the connection are reaped after 10 idle minutes), or via `close_session`.
Query parameters on the URL: `profile=<id>` (use that profile), `session=<id>` (attach to a REST-created
session instead of creating one), `ttl_s=<n>`.

### Tools
`navigate snapshot click fill press hover select_option wait_for screenshot get_text get_html evaluate
console_messages network_log tabs login request_human await_human session_info close_session`. `snapshot` returns an accessibility
tree with `[ref=…]` handles that `click`/`fill`/etc. accept; prefer it to screenshots. `console_messages`
and `network_log` are the debugging tools (JS errors, failed/4xx/5xx requests, requests the policy blocked).

## Profiles and auto-login

A profile = a named site definition (`browser_sites` in `playbooks/browser-service.yml`, credentials from the
Ansible vault, rendered to `/opt/secrets/browser-sites.json`, readable only by the container user) plus a
saved login state (cookies/localStorage) in the `browser-data` volume. Session create with a credentialed
profile: load saved state → check `verify` → if logged out, run the login → save state. Callers only ever
name the profile; they never see the username, password or TOTP secret.

Login definition fields: `login_url`, `username`, `password`, `totp_secret` (base32; optional),
`verify: {url, present|absent}` (**required**: a selector that proves you are logged in), and optionally
`form: {username,password,submit,totp}` selector overrides (defaults handle ordinary and two-step forms), or
`steps: [{goto|fill+value|click|press|wait_for}]` for odd sites (`{{username}} {{password}} {{totp}}` expand in values).

Sites with captcha, passkeys or interactive 2FA: use the human handoff below (profile without `username`/`password`).
`scripts/capture-state.mjs` (headed browser on your laptop → uploads the state) remains as a fallback for sites that refuse the headless browser even with a human at the keyboard.
A failed automatic login leaves a screenshot in the data volume (`/data/artifacts/login-failure-<id>.png`).

## Human handoff (sign-in, 2FA, captcha, Google SSO)

For logins the service cannot or should not do itself, the agent calls `request_human {reason}` and then `await_human`
(polls up to 55 s per call; `pending` means call again). The operator gets a **Discord** message with a link to
`/live/<id>?t=<token>`: a live view of the headless session (CDP screencast) they drive with mouse and keyboard from any
browser on the tailnet, including a phone (tap, drag-to-scroll, a type/paste box with optional masking, Tab/Enter/Back
buttons, address bar). **Done** saves the session's cookies and localStorage into the profile (`persist` profiles), so the
next session starts logged in; `login` then just verifies it (`verify` block) and tells the agent to call `request_human`
again when it has lapsed. The page can be iframed by the Arcana console (`FRAME_ANCESTORS`).

- The link token is scoped to one handoff, expires after 30 min (`HANDOFF_TTL_S`) and dies on Done/Cancel/session close. Key and text events are never logged.
- If Discord is not configured or fails, `request_human` returns the link to the caller instead (it is otherwise withheld from the agent).
- Needs a Discord channel webhook (`DISCORD_WEBHOOK_URL`, vault `vault_browser_discord_webhook`; use a private channel) and/or the bot DMing the operator (`DISCORD_BOT_TOKEN` = `vault_discord_bot_token`, `DISCORD_USER_ID` = `vault_discord_user_id`). Webhook is tried first, then DM. Messages carry empty `allowed_mentions` so agent text cannot ping anyone.
- Navigation during a handoff is still subject to the profile's `allowed_hosts`; add hosts a sign-in redirects through.

## Browser identity

Sessions present as an ordinary desktop Chrome, not "HeadlessChrome in UTC": no automation switches (`navigator.webdriver`
is false), a normal Chrome user agent matching the installed version, and the operator's timezone and locale
(`BROWSER_TIMEZONE`, `BROWSER_LOCALE`; playbook vars `browser_service_timezone/_locale`). Per-profile override:
`identity: {user_agent, locale, timezone}`. This is for the operator's own accounts at low volume; there is no captcha solving,
proxy rotation or fingerprint randomisation, and sites that still challenge go through the handoff.

## Safety model

- **Network guard** (every request incl. WebSockets, service workers blocked): private/loopback/link-local/tailnet
  addresses are blocked unless the host is in `browser_service_internal_hosts` (arcana-dev nodes). The browser cannot
  reach yugabytedb, MinIO, the cloud metadata IP, or this API. Hostnames are resolved and checked per request
  (a DNS-rebinding race remains theoretical; the container has no secrets or capabilities beyond the above).
- **Profile allowlist**: with `allowed_hosts`, top-level navigation outside it is refused, and credentials are
  never typed on a host outside it.
- **`evaluate` is off** for profiles with credentials (it could read session cookies) unless `allow_evaluate: true`.
- **Prompt injection**: page text is untrusted. Callers acting on a logged-in profile should keep a human in the
  loop for irreversible actions (purchases, deletes, sends); this service does not judge intent.
- The live view is full control of a session that may be logged in: tailnet-only, per-handoff token, `frame-ancestors` restricted, `no-store`/no-referrer.
- Container: non-root, `cap_drop: ALL`, `no-new-privileges`, 6 GB / 4 CPU / 1024 pids caps, max 4 sessions,
  idle TTL 30 min (10 for MCP), hard cap 4 h. Downloads and permission prompts are denied.
- `/data/audit.jsonl` logs every session/tool call (credentials redacted).
- Auth is one shared bearer token; the port is loopback + nginx-on-tailnet only.

## Operating it

```
ansible-playbook playbooks/browser-service.yml --check --diff && ansible-playbook playbooks/browser-service.yml
ansible-playbook playbooks/browser-service.yml --tags sites                      # re-render profiles/credentials
ansible-playbook playbooks/browser-service.yml -e browser_service_state=absent   # spin the whole service down (volume kept)
docker logs browser-service | tail      /  docker exec browser-service tail /data/audit.jsonl
```
Sessions come and go through the API; the container only has to be up.

## Testing

`test/smoke.mjs` drives a fixture login site through REST and MCP (18 checks: auth, secret-free listing, auto-login,
saved state reuse, allowlist, private-range blocking, session cap, MCP lifecycle, browser identity, and the full human handoff:
link security, screencast frames, mouse/key/paste input through the live view, state capture, cleanup). It runs inside the container:

```
docker build -t browser-service:test projects/browser-service
docker run -d --rm --name bs-test --init --shm-size=1g -e BROWSER_SERVICE_TOKEN=t -e ALLOW_INTERNAL_HOSTS=localhost \
  -e SITES_FILE=/app/test/sites.json -e DISCORD_WEBHOOK_URL=http://127.0.0.1:9911/discord-webhook \
  -e PUBLIC_URL=http://127.0.0.1:8931 -e FRAME_ANCESTORS=https://arcana.test -v $PWD/projects/browser-service/test:/app/test:ro browser-service:test
docker exec -e BROWSER_SERVICE_TOKEN=t bs-test node test/smoke.mjs; node --test projects/browser-service/test/notify.test.mjs; docker rm -f bs-test
```
