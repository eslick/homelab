# Arcana → homelab overview page: contribution contract

Audience: the Claude session working in `~/projects/arcana2`.
Owner of the page: the homelab session (`~/homelab`, Ansible-only change policy).

The homelab publishes a dashboard at `https://speedracer.terrier-haddock.ts.net/overview.html`
that stays at homelab level and delegates subsystems to their own pages. Arcana's page is
`https://speedracer.terrier-haddock.ts.net/arcana.html` (linked from the services index and the dashboard).

What the homelab already shows there (do not duplicate it):
- **Runtime wiring:** containers, ports, database, nginx vhost, dev-workflow diagram (Claude Code + MCP).
- **Static architecture views** derived from `DESIGN.md` and each subsystem's `dependencies/0`:
  the L0–L8 layered diagram, the subsystem connection block diagram with a dependency table,
  and the intent → proof → kernel pipeline. They are a snapshot (the page footer names the commit).

What it does **not** know is the live state and finer structure *inside* Arcana. You supply that:
up to three small HTML fragment files that the homelab splices into `/arcana.html` at deploy time.
This document is the contract.

If you change `DESIGN.md`, the layer map, or any `dependencies/0` so the page's static diagrams are
out of date, say so in your report to the user; the homelab session regenerates those diagrams.

## 1. Where the files live (you own them, they live in the arcana2 repo)

```
~/projects/arcana2/docs/homelab/
  overview-summary.html     # KPI tiles in the Summary grid of /arcana.html (optional)
  overview-hierarchy.html   # <li> items in the "Subsystem hierarchy" tree of /arcana.html (optional)
  overview-details.html     # free-form cards (text, tables, SVG diagrams) at the end of /arcana.html (optional)
```

Each file is optional. A missing or empty file just leaves its slot showing a placeholder.
Commit them in the arcana2 repo like any other doc; they are versioned with the code they describe.

## 2. How they get published

The homelab playbook reads the files at deploy time (no runtime fetch, no JavaScript):

```
cd ~/homelab
ansible-playbook playbooks/nginx.yml --check --diff --tags overview   # review
ansible-playbook playbooks/nginx.yml --tags overview                  # apply
```

Re-publish whenever the fragments change. If you cannot run Ansible, tell the user the fragments are
ready and which homelab command publishes them. Do not edit anything under `/var/www` by hand.

## 3. What belongs in each slot

Aim for "what is going on at a glance". Facts that change should come from the repo or a script
(e.g. a `make homelab.overview` target that regenerates the files), not be hand-typed numbers.
Date-stamp anything that is a snapshot.

**overview-summary.html** — 3 to 6 tiles, e.g. version/commit, number of subsystems up, migration
level, test/proof status (Lean / F* / ExUnit), queue depth, journal size, last green `make dev.check`.
Markup:

```html
<div class="widget">
  <div class="w-label">Migrations</div>
  <div class="w-value">9 <span class="pill ok">applied</span></div>
  <div class="w-sub">arcana_dev · snapshot 2026-10-04</div>
</div>
```

**overview-hierarchy.html** — the finer Arcana module/subsystem tree, as `<li>` elements only (the homelab
supplies the surrounding `<ul class="tree">`). The layer map and boot dependency graph are already
drawn by the homelab, so go deeper: the modules inside each subsystem and how they relate. Nest with `<ul>` / `<details>`. Show the real module/subsystem structure
(Repo, Journal, Queue, Lease, Index, kernel WASM, LLM adapter, admin console, formal proofs, ...),
taken from `DESIGN.md`, `docs/concepts/` and `lib/arcana/`. Markup:

```html
<li><details open><summary>Core <span class="tag">lib/arcana/core</span></summary>
  <ul>
    <li>Repo <span class="tag">YugabyteDB / YSQL</span></li>
    <li>Journal</li>
  </ul>
</details></li>
<li>Admin console <span class="tag">:4100</span></li>
```

**overview-details.html** — one or more `<div class="card">` blocks. Put an architecture diagram here
(data flow between subsystems, request path, proof pipeline) plus any tables or short notes.

```html
<div class="card">
  <h3>Subsystem data flow</h3>
  <div class="diagram"><svg viewBox="0 0 1000 400" role="img" aria-label="Arcana data flow">...</svg></div>
</div>
```

## 4. Rules (the page will break or look wrong otherwise)

1. Fragments only: no `<html>`, `<head>`, `<body>`, no `<script>`, no external URLs for CSS/JS/fonts/images.
2. No hard-coded colours. Use the page's classes / CSS variables so light and dark mode both work.
3. SVG: give it a `viewBox` and **no fixed width/height** (the page scales it); wrap it in `<div class="diagram">`;
   prefix every `id` (markers, gradients) with `arcana-` to avoid clashing with the page's own SVGs.
4. Keep each file under ~100 KB. Plain, accurate, current. Do not describe things the repo does not do.
5. Do not restate homelab wiring (host, nginx, ports, Docker, DB container) or the static layer and
   dependency diagrams the page already has. Describe Arcana's own finer structure and live state.
6. Never include secrets, API keys, tokens, or full connection URLs with credentials.

## 5. Styling vocabulary available to fragments

| Purpose | Markup |
|---|---|
| Card | `<div class="card"><h3>Title</h3>…</div>` |
| KPI tile | `.widget` > `.w-label`, `.w-value`, `.w-sub` |
| Status pill | `<span class="pill ok\|warn\|err\|info">text</span>` |
| Small tag | `<span class="tag">text</span>` |
| Table | `<table class="tbl">…</table>` |
| Key/value list | `<dl class="kv"><dt>…</dt><dd>…</dd></dl>` |
| Muted text | `<p class="muted">…</p>` |
| Diagram wrapper | `<div class="diagram"><svg viewBox="0 0 W H">…</svg></div>` |

SVG classes (inside `<svg>`):

| Class | Use |
|---|---|
| `node` + one of `k-app` `k-data` `k-gpu` `k-net` `k-sys` `k-ts` `k-ext` | boxes; the `k-*` suffix picks the accent colour |
| `zone` | dashed grouping rectangle (`fill:none`) |
| `edge` | connector path; add `marker-end="url(#arcana-arrow)"` and define that marker yourself |
| `t` | box title text (13 px semibold) |
| `s` | sub-label text (11 px muted) |
| `m` | monospace detail text (10.5 px) |
| `z` | zone/caption label (uppercase, muted) |

Colour meaning (keep it consistent with the homelab diagrams): `k-app` applications/containers,
`k-data` databases and storage, `k-gpu` GPU/inference, `k-net` ingress/network, `k-sys` host/system,
`k-ts` Tailscale, `k-ext` external services.

## 6. Suggested workflow for the arcana2 session

1. Read `DESIGN.md`, `PURPOSE.md`, `docs/concepts/`, and `lib/arcana/` to get the real subsystem list.
2. Create `docs/homelab/` and write the three fragments. Prefer a script or `make homelab.overview`
   that generates them from the repo so they stay current.
3. Open `https://speedracer.terrier-haddock.ts.net/overview.html#arcana` after publishing and check both
   light and dark mode and a narrow (phone) width.
4. Tell the user which files changed and that `--tags overview` republishes them.
