# OpenClaw Security Audit — 2026-04-07-02

**Status: ALERT — 3 warnings require manual intervention**

Summary: 0 critical · 3 warn · 1 info

---

## Auto-Fixed

File permission corrections were applied to 4 session files that had overly permissive modes:

- `~/.openclaw/agents/main/sessions/1338af92-2554-41ba-afc9-3cb00623fcb5.jsonl` → chmod 600
- `~/.openclaw/agents/main/sessions/3b221290-634b-409d-b774-51df5cd49309.jsonl` → chmod 600
- `~/.openclaw/agents/main/sessions/4d278e75-7773-421e-83a2-49b835de989d.jsonl` → chmod 600
- `~/.openclaw/agents/main/sessions/a2b567cc-82b7-49f0-b024-28898fe770ed.jsonl` → chmod 600

All other protected paths (`~/.openclaw/`, credentials, agents, existing sessions) were already correctly permissioned — no changes needed.

---

## Remaining Findings (Manual Action Required)

### WARN — `gateway.auth_no_rate_limit`: No auth rate limiting configured

`gateway.bind` is not loopback-only, but no `gateway.auth.rateLimit` is configured. This leaves the gateway exposed to brute-force auth attacks.

**Action:** Add rate limiting to `openclaw.json`:

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

### WARN — `security.trust_model.multi_user_heuristic`: Potential multi-user setup on personal-assistant model

Heuristic signals suggest this gateway may be reachable by multiple users:
- `channels.discord.groupPolicy="allowlist"` with configured group targets
- `channels.telegram.groupPolicy="allowlist"` with configured group targets
- Runtime/process tools (`exec`, `process`) exposed with `sandbox=off` and `fs.workspaceOnly=false` in both `agents.defaults` and `agents.list.main`

OpenClaw's security model is personal-assistant (single trusted operator), not multi-tenant isolation. Since Discord/Telegram allowlists are intentional (known trusted users), this is likely expected — but the unsandboxed runtime exposure warrants a conscious decision.

**Action (choose one):**

- **If all channel users are fully trusted:** Acknowledge and document this as intentional. No config change needed.
- **If any channel users are not mutually trusted:** Either split to separate gateways per trust boundary, or harden in-place:
  - Set `agents.defaults.sandbox.mode="all"`
  - Set `tools.fs.workspaceOnly=true`
  - Remove `exec`/`process` from runtime tools unless explicitly required
  - Ensure no personal credentials are accessible in this runtime context

---

### WARN — `plugins.installs_unpinned_npm_specs`: Unpinned plugin install spec

The `manifest` plugin is installed without a pinned version, creating supply-chain instability risk.

**Action:** Pin the manifest plugin to an exact version in OpenClaw's plugin config. Replace the bare `manifest` spec with an exact version, e.g.:

```
@scope/manifest@1.2.3
```

Check the currently installed version at `/home/node/.openclaw/extensions/manifest/dist/index.js` to determine the version to pin.

---

### Config Warning — Duplicate plugin ID

A duplicate plugin ID was detected: the global `manifest` plugin is being overridden by another global plugin at `/home/node/.openclaw/extensions/manifest/dist/index.js`. This is likely related to the unpinned install above.

**Action:** Investigate whether two copies of the manifest plugin are installed and remove the duplicate.

---

## Info / Attack Surface Summary

| Item | Value |
|------|-------|
| Open groups | 0 |
| Allowlist groups | 2 (Discord, Telegram) |
| Elevated tools | enabled |
| Webhooks | disabled |
| Internal hooks | enabled |
| Browser control | enabled |
| Trust model | personal-assistant (single operator boundary) |

---

## Priority

| # | Finding | Priority |
|---|---------|----------|
| 1 | Auth rate limiting missing | High — add before next deployment |
| 2 | Unsandboxed runtime on multi-channel setup | Medium — assess trust model intentionality |
| 3 | Unpinned plugin / duplicate manifest | Low — pin on next plugin update |
