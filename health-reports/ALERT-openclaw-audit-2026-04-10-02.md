# OpenClaw Security Audit — 2026-04-10-02

**Result: ALERT** — 3 warnings require manual action

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Warn     | 3 |
| Info     | 1 |

All 3 warnings survived the auto-fix run and require manual configuration changes.

---

## Auto-Fixed

The `--fix` run corrected file permissions only:

- `chmod 600` applied to 2 session files that were world/group readable:
  - `~/.openclaw/agents/main/sessions/0734d769-25e6-4283-b79f-f6d552d0fbe8.jsonl`
  - `~/.openclaw/agents/main/sessions/cec57a1c-ef05-4e2a-a66a-25198c4eb0f8.jsonl`
- All other credential and config files already had correct permissions (no-op).

---

## Remaining Warnings (Manual Action Required)

### 1. `gateway.auth_no_rate_limit` — No auth rate limiting configured

**Risk:** Gateway is bound to a non-loopback address with no brute-force protection. An attacker with network access can attempt unlimited auth guesses.

**Fix:** Add `gateway.auth.rateLimit` to `openclaw.json`, e.g.:

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

### 2. `security.trust_model.multi_user_heuristic` — Potential multi-user setup with unsandboxed tools

**Risk:** Both Discord and Telegram channels are configured with allowlist group policies, meaning multiple external users can reach an agent that has `sandbox=off`, unrestricted filesystem access (`fs.workspaceOnly=false`), and `exec`/`process` runtime tools enabled. This is the highest-impact finding.

**Signals detected:**
- `channels.discord.groupPolicy="allowlist"` with configured group targets
- `channels.telegram.groupPolicy="allowlist"` with configured group targets
- `agents.defaults` and `agents.list.main` both have `sandbox=off`, `runtime=[exec, process]`, `fs=[read, write, edit, apply_patch]`, `fs.workspaceOnly=false`

**Fix options (choose one):**
- **If users are mutually trusted (personal-assistant model):** No structural change needed, but consider enabling `agents.defaults.sandbox.mode="all"` and setting `fs.workspaceOnly=true` as defense-in-depth.
- **If users may be mutually untrusted:** Split into separate gateways with separate credentials and OS users/hosts. This cannot be auto-fixed.

Recommended minimum hardening even for trusted setup:
```json
"agents": {
  "defaults": {
    "sandbox": { "mode": "all" },
    "tools": { "fs": { "workspaceOnly": true } }
  }
}
```

---

### 3. `plugins.installs_unpinned_npm_specs` — Unpinned plugin install spec

**Risk:** The `manifest` plugin is installed without a pinned version (`manifest` rather than `@scope/manifest@x.y.z`). A supply-chain compromise or accidental breaking update could be pulled in automatically.

**Fix:** Pin the manifest plugin to an exact version in the plugin install config:

```json
{ "id": "manifest", "spec": "@openclaw/manifest@1.2.3" }
```

Replace `1.2.3` with the currently installed version (`openclaw plugins list` to check).

---

## Config Warning (Non-Security)

- **Duplicate plugin ID:** The `manifest` plugin ID is registered twice; the second registration (from `/home/node/.openclaw/extensions/manifest/dist/index.js`) overrides the first. This is likely benign but should be resolved by removing the duplicate entry from the plugin manifest config.

---

## Attack Surface (Info)

| Item | Value |
|------|-------|
| Open groups | 0 |
| Allowlist groups | 2 (Discord, Telegram) |
| Elevated tools | enabled |
| Webhooks | disabled |
| Internal hooks | enabled |
| Browser control | enabled |
| Trust model | personal-assistant |

---

## Recommended Next Steps

1. **Immediate:** Add `gateway.auth.rateLimit` to config (finding #1).
2. **Soon:** Enable `agents.defaults.sandbox.mode="all"` and `fs.workspaceOnly=true` (finding #2).
3. **Before next plugin update:** Pin the `manifest` plugin spec to an exact version (finding #3).
4. **Housekeeping:** Resolve the duplicate plugin ID in the manifest config.
