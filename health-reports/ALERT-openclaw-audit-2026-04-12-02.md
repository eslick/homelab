# OpenClaw Security Audit — 2026-04-12 02:00

## Status: ALERT

The OpenClaw container was **not running** at the time of audit. Both the security scan and the auto-fix step failed because Docker could not attach to the container.

---

## Summary of Findings

| Severity | Finding | Status |
|----------|---------|--------|
| CRITICAL | OpenClaw container is not running | Requires manual intervention |
| N/A | Security audit could not execute | Blocked by container-down state |
| N/A | Auto-fix could not execute | Blocked by container-down state |

---

## Audit Output

```
Error response from daemon: container 7ea156043fcaa4d27b7adc53029488e2b857f420c3ac1125e9ff6715f6affc94 is not running
```

The container ID referenced (`7ea156043fca...`) exists in Docker's registry but is stopped or exited. The audit script attempted to exec into the container and received a daemon error.

---

## Auto-Fix Output

```
Error response from daemon: container 7ea156043fcaa4d27b7adc53029488e2b857f420c3ac1125e9ff6715f6affc94 is not running
```

Auto-fix also failed — no remediations were applied.

---

## What Was Auto-Fixed

Nothing. All auto-fix steps were skipped due to the container being down.

---

## Required Manual Actions

1. **Investigate why the container stopped:**
   ```bash
   docker ps -a | grep openclaw
   docker logs 7ea156043fca
   ```

2. **Check for OOM kills or crash loops:**
   ```bash
   journalctl -u docker --since "1 hour ago" | grep -i openclaw
   dmesg | grep -i oom | tail -20
   ```

3. **Restart via Ansible (per Prime Directive):**
   ```bash
   ansible-playbook playbooks/docker.yml --tags docker --check --diff
   ansible-playbook playbooks/docker.yml --tags docker
   ```

4. **Re-run the security audit** once the container is healthy.

5. **Investigate root cause** before closing this alert — if the container crashed, determine whether it was a security-related crash (e.g., exploit attempt, resource exhaustion attack) or an operational failure.

---

## References

- Container ID: `7ea156043fcaa4d27b7adc53029488e2b857f420c3ac1125e9ff6715f6affc94`
- Audit timestamp: 2026-04-12T02:00
