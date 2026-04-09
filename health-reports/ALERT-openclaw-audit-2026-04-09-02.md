# ALERT: OpenClaw Security Audit — 2026-04-09-02

**Result:** 0 critical · 3 warn · 1 info  
**Status:** Manual intervention required (3 warnings unresolved)

---

## Summary of Findings

| Severity | ID | Description |
|---|---|---|
| WARN | `gateway.auth_no_rate_limit` | No auth rate limiting configured |
| WARN | `security.trust_model.multi_user_heuristic` | Multi-user heuristic detected; unsandboxed tool exposure |
| WARN | `plugins.installs_unpinned_npm_specs` | `manifest` plugin installed without pinned version |
| INFO | `summary.attack_surface` | Attack surface summary (no action needed) |
| CONFIG | `plugins.entries.manifest` | Duplicate plugin ID — global plugin overridden by local |

---

## Auto-Fixed

The `openclaw security audit --fix` run corrected file permissions on 3 session files that were too permissive. All other paths were already correct.

| Action | Path |
|---|---|
| `chmod 600` | `~/.openclaw/agents/main/sessions/2ebff8b1-...jsonl` |
| `chmod 600` | `~/.openclaw/agents/main/sessions/6634c8e2-...jsonl` |
| `chmod 600` | `~/.openclaw/agents/main/sessions/f4418054-...jsonl` |

---

## Remaining Actions Required

### 1. `gateway.auth_no_rate_limit` — Add auth rate limiting

The gateway bind address is not loopback, leaving auth endpoints exposed to brute-force attacks.

**Fix:** Add to `openclaw.json` (or equivalent config):
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

### 2. `security.trust_model.multi_user_heuristic` — Unsandboxed tools in multi-user context

Both Discord and Telegram channels use `groupPolicy="allowlist"` with configured targets, which the heuristic flags as potential multi-user exposure. Meanwhile, `exec`, `process`, and unrestricted filesystem tools are enabled with `sandbox=off` on both `agents.defaults` and `agents.list.main`.

**Affected contexts:**
- `agents.defaults` — `sandbox=off`, `runtime=[exec, process]`, `fs=[read,write,edit,apply_patch]`, `fs.workspaceOnly=false`
- `agents.list.main` — same

**Fix options (choose one):**

- **If all channel users are trusted (single-operator model):** No change needed; this is the intended personal-assistant model. Document the decision.
- **If any channel users may be mutually untrusted:** Set `agents.defaults.sandbox.mode="all"`, enforce `fs.workspaceOnly=true`, and remove `exec`/`process`/`fs.write` tools from shared agent contexts. Consider separate gateways per trust boundary.

---

### 3. `plugins.installs_unpinned_npm_specs` — Pin the `manifest` plugin

The `manifest` plugin is recorded without an exact version, creating supply-chain risk on reinstall.

**Fix:** Update the plugin install record to an exact version, e.g.:
```
@openclaw/plugin-manifest@1.2.3
```
Run `openclaw plugin update manifest` after pinning to confirm the installed version.

---

### 4. `plugins.entries.manifest` — Duplicate plugin ID (config warning)

A duplicate `manifest` plugin ID was detected; the global entry is being overridden by the local extension at `/home/node/.openclaw/extensions/manifest/dist/index.js`. This may be intentional (local dev override) but should be confirmed. If not intentional, remove the duplicate registration.

---

## Attack Surface (INFO)

| Signal | Value |
|---|---|
| Open groups | 0 |
| Allowlist groups | 2 (Discord, Telegram) |
| Elevated tools | enabled |
| Webhooks | disabled |
| Internal hooks | enabled |
| Browser control | enabled |
| Trust model | personal-assistant (single operator boundary) |
