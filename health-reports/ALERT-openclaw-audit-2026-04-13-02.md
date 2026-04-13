# ALERT: OpenClaw Security Audit — 2026-04-13 02:00

## Summary

The OpenClaw security audit failed to complete because the **OpenClaw container is not running**. Both the audit and the attempted auto-fix were blocked by the same error.

**Status: ALERT — manual intervention required**

---

## Findings

| Severity | Finding | Status |
|----------|---------|--------|
| CRITICAL | OpenClaw container is not running | Not resolved |

### Error Detail

```
Error response from daemon: container 7ea156043fcaa4d27b7adc53029488e2b857f420c3ac1125e9ff6715f6affc94 is not running
```

The container ID referenced (`7ea156043fca...`) no longer corresponds to a running container. The audit tool attempted to exec into it and the auto-fix script also targeted the same stopped container — both failed for the same reason.

---

## What Was Auto-Fixed

Nothing. The auto-fix script could not execute because it required a running container to apply remediations.

---

## Remaining Actions Required

1. **Investigate why the container stopped:**
   ```bash
   docker ps -a | grep openclaw
   docker logs <container_id_or_name>
   ```

2. **Restart via Ansible (per Prime Directive — do not run `docker start` directly):**
   ```bash
   ansible-playbook playbooks/docker.yml --tags docker
   ```

3. **Verify the container is healthy after restart:**
   ```bash
   docker ps --filter name=openclaw
   ```

4. **Re-run the security audit** once the container is confirmed running to get actual audit findings.

5. **Investigate root cause** — determine whether the container crashed, was stopped manually, OOM-killed, or failed a healthcheck. Check `journalctl` and `docker events` logs.

---

## References

- Compose file: `/opt/compose/openclaw/docker-compose.yml`
- Playbook: `playbooks/docker.yml`
