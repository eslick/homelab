# OpenClaw Security Audit — 2026-04-08-02

**Result: ALERT** — 3 warnings require manual intervention

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Warn     | 3 |
| Info     | 1 |
| Config   | 1 (duplicate plugin ID) |

All 3 warnings were **not** auto-fixable and require manual action (see below).

---

## Auto-Fixed

The `--fix` pass corrected file permissions on 3 session files that were too permissive:

- `~/.openclaw/agents/main/sessions/6f1461b4-ecf0-46a9-95a8-434a2bb8837d.jsonl` → chmod 600
- `~/.openclaw/agents/main/sessions/be2f1335-b0f6-446f-a3da-35af1f5b3f00.jsonl` → chmod 600
- `~/.openclaw/agents/main/sessions/ffd10b69-3cab-4a48-a655-e09fe62ff413.jsonl` → chmod 600

All other paths (`~/.openclaw/`, credentials, agent directories, remaining session files) were already correctly permissioned — no action taken.

---

## Config Warning

**`plugins.entries.manifest`: Duplicate plugin ID**

- The `manifest` plugin ID appears more than once; the global plugin at `/home/node/.openclaw/extensions/manifest/dist/index.js` will override the earlier entry.
- **Action**: Inspect `~/.openclaw/openclaw.json` (or equivalent config) and remove the duplicate plugin entry. Confirm only one `manifest` plugin is registered.

---

## Remaining Warnings (Manual Action Required)

### 1. `gateway.auth_no_rate_limit` — No Auth Rate Limiting

**Risk**: `gateway.bind` is not loopback. Without rate limiting, the auth endpoint is vulnerable to brute-force attacks.

**Action**: Add rate limiting to `gateway.auth.rateLimit` in `openclaw.json`. Suggested config:

```json
"gateway": {
  "auth": {
    "rateLimit": {
      "maxAttempts": 10,
      "windowMs": 60000,
      "lockoutMs": 300000
    }
  }
}
```

---

### 2. `security.trust_model.multi_user_heuristic` — Multi-User Exposure with Unsandboxed Agents

**Risk**: Discord and Telegram channels are configured with allowlist group policies, suggesting multiple users can reach this gateway. However, agents run with full unsandboxed access:

- `agents.defaults`: sandbox=off; runtime=[exec, process]; fs=[read, write, edit, apply_patch]; fs.workspaceOnly=false
- `agents.list.main`: same

This means any allowlisted user can invoke exec/process/fs tools without containment.

**Action** (choose one based on intent):

- **If all allowlisted users are fully trusted** (personal homelab use only): document this decision and accept the risk. Consider setting `fs.workspaceOnly=true` as a minimum guard.
- **If any user is not fully trusted**: enable sandboxing: `agents.defaults.sandbox.mode="all"`, set `tools.fs.workspaceOnly=true`, and remove `runtime` and broad `fs` tools from the default toolset. Move privileged tools to a separate, restricted agent.

---

### 3. `plugins.installs_unpinned_npm_specs` — Unpinned Plugin Install

**Risk**: The `manifest` plugin is installed without a pinned version. Future installs or rebuilds could pull a different (potentially compromised) version.

**Action**: Pin the install spec to an exact version in the plugin configuration. Example:

```json
{ "id": "manifest", "spec": "@openclaw/manifest@1.2.3" }
```

Look up the currently installed version (`npm list` in the extensions directory or check `package.json`) and lock to that exact version.

---

## Attack Surface (Info)

- Open groups: 0
- Allowlist groups: 2 (Discord, Telegram)
- Elevated tools: enabled
- Webhooks: disabled
- Internal hooks: enabled
- Browser control: enabled
- Trust model: personal-assistant (single operator boundary)

---

## Next Steps (Priority Order)

1. **High**: Configure `gateway.auth.rateLimit` — straightforward config change, mitigates brute-force risk on the exposed gateway.
2. **High**: Resolve sandbox posture for multi-user channels — decision needed on trust model before config changes.
3. **Medium**: Pin the `manifest` plugin npm spec to an exact version.
4. **Low**: Remove duplicate `manifest` plugin entry from config.
