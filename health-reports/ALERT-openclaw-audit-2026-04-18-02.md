# ALERT: OpenClaw Security Audit — 2026-04-18-02

## Summary

The OpenClaw security audit failed to execute because the OpenClaw container is not running. Both the audit step and the auto-fix step returned the same error, indicating the container was stopped or crashed before the audit began.

**Severity: HIGH** — Container is not running; service is unavailable.

## Findings

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | OpenClaw container is not running | HIGH | Requires manual intervention |

**Raw error (audit and auto-fix):**
```
Error response from daemon: container 7ea156043fcaa4d27b7adc53029488e2b857f420c3ac1125e9ff6715f6affc94 is not running
```

## Auto-Fixed

Nothing was auto-fixed. The container was unreachable for both the audit and fix steps.

## Remaining Actions Required

1. **Investigate why the container stopped:**
   ```bash
   docker ps -a | grep openclaw
   docker logs <openclaw-container-name> --tail 100
   ```

2. **Check for OOM kills or system events:**
   ```bash
   journalctl -u docker --since "1 hour ago" | grep -i "openclaw\|oom\|kill"
   dmesg | grep -i "oom\|killed" | tail -20
   ```

3. **Restart via Ansible (per Prime Directive):**
   ```bash
   ansible-playbook playbooks/docker.yml --tags docker
   ```

4. **Re-run security audit** once the container is confirmed healthy:
   ```bash
   docker ps --filter name=openclaw
   ```

5. **If container fails to start**, inspect compose config:
   ```bash
   cat /opt/compose/openclaw/docker-compose.yml
   docker compose -f /opt/compose/openclaw/docker-compose.yml up --dry-run
   ```
