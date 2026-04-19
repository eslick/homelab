# OpenClaw Security Audit — 2026-04-19 02:00

## Status: ALERT

The audit could not complete because the `openclaw-gateway` container does not exist.

---

## Summary of Findings

| Severity | Finding | Status |
|----------|---------|--------|
| ALERT | `openclaw-gateway` container not found | Requires manual investigation |

---

## Audit Output

```
Error response from daemon: No such container: openclaw-gateway
```

## Auto-Fix Output

```
Error response from daemon: No such container: openclaw-gateway
```

No security findings were assessed — the audit target was unreachable.

---

## What Was Auto-Fixed

Nothing. The audit script could not connect to the container.

---

## Remaining Actions Required

1. **Determine container state**: Run `docker ps -a | grep openclaw` to check whether the container exists but is stopped, or has been removed entirely.
2. **Check compose stack**: Verify the OpenClaw compose stack is defined and deployed:
   ```
   cat /opt/compose/openclaw/docker-compose.yml
   ```
3. **If recently removed**: The recent commits (`ff2ce27`, `405710b`) removed the OpenClaw installation. If OpenClaw is intentionally decommissioned, disable or remove the security audit cron job to prevent future alerts.
4. **If unintentionally down**: Re-deploy via:
   ```
   ansible-playbook playbooks/docker.yml --tags openclaw
   ```
   Then re-run the security audit.

---

## Context

Recent git history shows OpenClaw was intentionally removed:
- `ff2ce27 chore(openclaw): remove host cache directory`
- `405710b chore(openclaw): remove installation, preserve data volume`

Most likely the audit cron job is targeting a decommissioned service and should be updated or removed.
