# OpenClaw Security Audit — 2026-04-11-02

**Status: ALERT** — 3 warnings require manual intervention

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Warn     | 3 |
| Info     | 1 |

Config warning: duplicate plugin ID detected for `manifest` plugin — global plugin being overridden by global plugin at `/home/node/.openclaw/extensions/manifest/dist/index.js`.

---

## Auto-Fixed

The `--fix` run corrected file permissions on session files that were not properly restricted to `600`:

- `~/.openclaw/agents/main/sessions/5225b204-9231-4bfa-b446-5e933f881684.jsonl`
- `~/.openclaw/agents/main/sessions/568d3ddc-dfed-43c4-8806-2c9abcfae44d.jsonl`
- `~/.openclaw/agents/main/sessions/597d958b-81b8-476c-8837-93ae7d5a2ed0.jsonl`
- `~/.openclaw/agents/main/sessions/9c8e87a2-bb99-418a-9464-a76c29cd4237.jsonl`

All other paths (`~/.openclaw/`, `credentials/`, `agents/main/`, etc.) were already correctly permissioned — no changes needed.

---

## Remaining Warnings — Manual Action Required

### 1. `gateway.auth_no_rate_limit` — No Auth Rate Limiting Configured

**Risk:** The gateway is bound to a non-loopback address with no brute-force protection on auth.

**Action:** Add `gateway.auth.rateLimit` to `openclaw.json`:

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

### 2. `security.trust_model.multi_user_heuristic` — Multi-User Setup with Unsandboxed Tools

**Risk:** Both Discord and Telegram channels use `groupPolicy="allowlist"` with group targets, which heuristically indicates multiple users may reach this gateway. However, runtime tools (`exec`, `process`) and filesystem tools (`read`, `write`, `edit`, `apply_patch`) are exposed **without sandboxing** in:

- `agents.defaults` — `sandbox=off`, `fs.workspaceOnly=false`
- `agents.list.main` — `sandbox=off`, `fs.workspaceOnly=false`

**Decision required:** This is a single-operator homelab, so the personal-assistant trust model is likely intentional. Confirm this is the case, then choose one of:

- **Option A (trusted users only):** Accept current config; document that all allowlisted users are trusted operators.
- **Option B (tighten for shared access):** Set `agents.defaults.sandbox.mode="all"`, set `fs.workspaceOnly=true`, and remove `exec`/`process` tools from any context accessible to untrusted users.

---

### 3. `plugins.installs_unpinned_npm_specs` — Unpinned Plugin Spec

**Risk:** The `manifest` plugin is installed with an unpinned spec (`manifest`), which allows silent version drift and supply-chain instability.

**Action:** Pin the manifest plugin to an exact version in the plugin install config:

```json
"manifest": "@scope/manifest@1.2.3"
```

Replace `1.2.3` with the currently installed version (`openclaw plugins list` to find it).

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
| Trust model | personal-assistant (single trusted operator) |

---

## Recommended Next Steps

1. Apply auth rate limiting to `openclaw.json` (item 1 above) — straightforward config change.
2. Decide on trust model for Discord/Telegram group users and document decision (item 2).
3. Pin the manifest plugin to an exact version (item 3).
4. Run `openclaw security audit --deep` for a more thorough follow-up scan.
