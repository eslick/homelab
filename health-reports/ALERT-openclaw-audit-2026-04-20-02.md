# OpenClaw Security Audit — 2026-04-20-02

## Status: ALERT — Audit Could Not Complete

## Summary

The security audit failed because the `openclaw-gateway` container does not exist on the host. Docker returned:

```
Error response from daemon: No such container: openclaw-gateway
```

OpenClaw was previously removed (see commit `405710b` — "chore(openclaw): remove installation, preserve data volume"). No running service means no attack surface, but it also means the audit tooling assumed a deployment that is no longer present.

## Findings

| Severity | Finding | Status |
|---|---|---|
| INFO | `openclaw-gateway` container not running | Expected — service was intentionally removed |
| WARN | Audit script targets a container that no longer exists | Requires manual intervention |

## Auto-Fix Results

No fixes were applied — the auto-fix step also failed with the same `No such container: openclaw-gateway` error.

## Remaining Actions Required

1. **Update or disable the audit script** so it does not target `openclaw-gateway` when OpenClaw is not deployed. Options:
   - Remove or disable the audit cron/trigger entirely.
   - Add a container-existence check at the top of the audit script that exits cleanly when the container is absent.

2. **Confirm intentional removal** — if OpenClaw is expected to return, re-deploy via `playbooks/docker.yml` before re-running the audit.

## No Rollback Needed

This audit produced no system changes. No rollback required.
