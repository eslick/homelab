# ALERT: OpenClaw Security Audit — 2026-04-14 02:00

## Summary

The OpenClaw security audit failed to execute because the OpenClaw container is **not running**. Both the audit and auto-fix steps returned the same error:

```
Error response from daemon: container 7ea156043fcaa4d27b7adc53029488e2b857f420c3ac1125e9ff6715f6affc94 is not running
```

No security findings could be collected. No auto-fixes were applied.

## Findings

| Severity | Finding | Status |
|----------|---------|--------|
| CRITICAL | OpenClaw container is not running | Requires manual intervention |

## Auto-Fixed

None — auto-fix could not proceed because the container was not running.

## Remaining Actions Required

1. **Investigate why the container stopped:**
   ```
   docker inspect 7ea156043fca
   docker logs 7ea156043fca
   ```

2. **Check for OOM kills or host-level issues:**
   ```
   journalctl -u docker --since "1 hour ago"
   dmesg | grep -i "oom\|killed" | tail -20
   ```

3. **Restart the container via Ansible (per Prime Directive):**
   ```
   ansible-playbook playbooks/docker.yml --tags docker
   ```

4. **Re-run the security audit** once the container is back up to get a clean baseline.

## Alert Reason

Container was not running at audit time — this is an unplanned outage requiring investigation before the service is restored.
