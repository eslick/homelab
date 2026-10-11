# 2026-10-11 browser-service: viewport/colour-scheme options and pointer tool

## Task
Arcana task `arc-2` (request: `~/projects/arcana2/homelab-arc-2.md`): Arcana's UI browser tests need a per-session
viewport and colour scheme on `/mcp`, real pointer input for canvas content, and answers on WebGL2, tiles and iframes.

## Playbook Used
`playbooks/browser-service.yml` (no playbook edit; the image rebuilds from `projects/browser-service` source).
Code: `src/sessions.js` (`parseEmulation`), `src/mcp.js`, `src/server.js`, `src/tools.js`, `test/smoke.mjs`, README.

Shipped:
- `/mcp` query params and `POST /v1/sessions` fields: `viewport` (`WxH` or `{width,height}`), `color_scheme`, `reduced_motion`,
  `device_scale_factor`, `has_touch`. Bad values give 400. `session=<id>` attach is unchanged.
- Tools: `pointer` (click|dblclick|move|down|up|wheel), `click.position`, `set_color_scheme`.
- Confirmed, no change: WebGL2 works; subresources to public hosts are not restricted by `allowed_hosts` (guard.js);
  iframe elements are reachable by chained selector `iframe >> internal:control=enter-frame >> button`.

## Verification Steps
- Smoke suite in a throwaway container: 19 checks pass, including the new viewport/colour/pointer/iframe check.
- After deploy: `/mcp?profile=arcana&viewport=390x844&color_scheme=dark` gives innerWidth 390 and dark matches; `GET /v1/tools` lists `pointer`.

## Rollback
`git revert` the commit and re-run `ansible-playbook playbooks/browser-service.yml`. No data or config format changes.
