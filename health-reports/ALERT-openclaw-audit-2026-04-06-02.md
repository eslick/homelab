# ALERT: OpenClaw Security Audit — 2026-04-06 02:xx

**Result:** 0 critical · 3 warn · 1 info  
**Status:** 3 warnings require manual intervention

---

## Summary

The OpenClaw security audit (`openclaw security audit --fix`) completed successfully. File permission fixes were applied automatically. However, all three WARN-level findings remain open and require operator action.

---

## Auto-Fixed

| Action | Detail |
|--------|--------|
| `chmod 600` | `~/.openclaw/agents/main/sessions/32ff0dea-60f9-43fb-8e76-8d2b538218c6.jsonl` |

All other file/directory permissions were already correct (14 items skipped as already compliant).

---

## Open Findings — Manual Action Required

### WARN-1: No Auth Rate Limiting (`gateway.auth_no_rate_limit`)

**Risk:** Gateway is not bound to loopback and has no brute-force protection on auth endpoints.

**Fix:** Add `gateway.auth.rateLimit` to `~/.openclaw/openclaw.json`:
```json
"auth": {
  "rateLimit": {
    "maxAttempts": 10,
    "windowMs": 60000,
    "lockoutMs": 300000
  }
}
```

---

### WARN-2: Potential Multi-User Setup Detected (`security.trust_model.multi_user_heuristic`)

**Risk:** Discord and Telegram channels both use `groupPolicy="allowlist"` with configured group targets. Simultaneously, `agents.defaults` and `agents.list.main` run with `sandbox=off`, full `runtime=[exec, process]`, and `fs.workspaceOnly=false`. If any allowlisted user is not fully trusted, this is a significant privilege escalation risk.

**Signals that triggered this warning:**
- `channels.discord.groupPolicy="allowlist"` with group targets configured
- `channels.telegram.groupPolicy="allowlist"` with group targets configured
- Runtime/process tools exposed without sandboxing in both default and main agent contexts

**Fix options (choose one based on actual trust model):**

- **Option A — Single trusted operator (current intent):** Confirm all allowlisted users are fully trusted. No config change needed, but document the decision.
- **Option B — Shared/semi-trusted users:** Enable sandbox mode and restrict tool exposure:
  ```json
  "agents": {
    "defaults": {
      "sandbox": { "mode": "all" },
      "tools": { "fs": { "workspaceOnly": true } }
    }
  }
  ```
  Remove `exec`, `process`, and broad `fs` tools from any context accessible to less-trusted users. Move personal credentials off this runtime.

---

### WARN-3: Unpinned Plugin npm Spec (`plugins.installs_unpinned_npm_specs`)

**Risk:** The `manifest` plugin is installed without a pinned version, creating supply-chain instability (a compromised package version could be pulled on next install).

**Unpinned records:**
- `manifest` (spec: `manifest`)

**Fix:** Pin the manifest plugin to an exact version in the OpenClaw plugin config:
```
manifest@1.x.y   ← replace with the actual installed version
```
Run `openclaw plugin list` to find the current version, then update the install spec to `@scope/manifest@x.y.z`.

---

## Config Warnings (non-blocking)

A duplicate plugin ID was detected for the `manifest` plugin:
```
plugins.entries.manifest: duplicate plugin id detected; global plugin will be
overridden by global plugin (/home/node/.openclaw/extensions/manifest/dist/index.js)
```
This is likely a side effect of the unpinned install in WARN-3. Pinning and reinstalling the plugin should resolve this.

---

## Attack Surface (INFO)

| Surface | State |
|---------|-------|
| Open groups | 0 |
| Allowlist groups | 2 (Discord, Telegram) |
| Elevated tools | enabled |
| Webhooks | disabled |
| Internal hooks | enabled |
| Browser control | enabled |
| Trust model | personal-assistant (single operator boundary) |

---

## Recommended Action Order

1. **Immediate:** Add `gateway.auth.rateLimit` (WARN-1) — low effort, high impact.
2. **Review:** Confirm all Discord/Telegram allowlist members are fully trusted operators; document decision (WARN-2).
3. **Maintenance:** Pin the `manifest` plugin to an exact version (WARN-3).
4. **Optional deep scan:** `openclaw security audit --deep` for additional findings.
