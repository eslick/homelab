# ALERT: OpenClaw Security Audit — 2026-04-23-02

## Summary

The security audit failed because the target container **`openclaw-gateway` does not exist** on the host. Neither the audit nor the auto-fix steps could execute.

| Item | Status |
|------|--------|
| Container `openclaw-gateway` | **NOT FOUND** |
| Audit executed | No |
| Auto-fix executed | No |
| Manual intervention required | **Yes** |

## Findings

### CRITICAL — Container Missing

```
Error response from daemon: No such container: openclaw-gateway
```

The container is absent from Docker entirely. Possible causes:

- OpenClaw was never deployed or the compose stack was never started
- The container crashed and was not restarted (no restart policy, or restart limit exceeded)
- The container was stopped or removed manually outside of Ansible
- The compose file or service name changed, leaving the old container reference stale

## What Was Auto-Fixed

Nothing. Both audit and auto-fix steps failed with the same error.

## Required Actions

1. **Check compose stack status:**
   ```
   docker compose -f /opt/compose/openclaw/docker-compose.yml ps
   ```

2. **Check for stopped/exited containers:**
   ```
   docker ps -a --filter name=openclaw
   ```

3. **Review Docker logs for crash reason (if container exists but exited):**
   ```
   docker logs openclaw-gateway --tail 100
   ```

4. **If the stack is simply down, bring it up via Ansible:**
   ```
   ansible-playbook playbooks/docker.yml --tags openclaw
   ```

5. **If the container name changed**, update the audit script to match the current container name in the compose file.

6. **If the service was intentionally removed**, this alert can be dismissed and the audit script should be retired or updated.

## References

- Compose template: `templates/openclaw-compose.yml.j2`
- Playbook: `playbooks/docker.yml`
