#!/usr/bin/env python3
"""Regenerate the layer + connection SVGs in templates/arcana-overview.html.j2 (usage: python3 scripts/gen-arcana-overview-svg.py templates/arcana-overview.html.j2). Edit the module lists below from DESIGN.md and Arcana.Subsystems.integrated/0 first."""
import re, sys
from xml.sax.saxutils import escape

TPL = sys.argv[1]

# ---------------------------------------------------------------- layers
X0, W = 180, 720            # layer band
PAD, CH, GAP, VG = 16, 30, 8, 10   # side pad, chip height, chip gap, row gap

# (label, status, status-class, [ [ (text, kind) ... ] per chip line ], substrate?)
rows = [
    ("L8 · Patterns", ["planned"], False, [[("Meta-agents", "k-ext"), ("Agent builder", "k-ext"), ("Agent UI patterns", "k-ext")]]),
    ("L7 · Plugins", ["planned"], False, [[("Plugin model", "k-ext"), ("Discord", "k-ext"), ("Hosted-app builder skills", "k-ext")]]),
    ("L6 · UX &amp; Web", ["shipped"], False, [[("Workspace UI", "k-app"), ("Admin console", "k-app"), ("Dev MCP", "k-app"), ("Web push (PWA)", "k-app"), ("CNL read-back", "k-ext")]]),
    ("L5 · Libs", ["LLM, MCP, push shipped", "Together is a stub"], False, [
        [("Lib.LLM · profiles", "k-app"), ("Backend · Anthropic", "k-app"), ("Backend · OpenAICompat", "k-app"), ("Lib.MCP · OAuth", "k-app")],
        [("Backend · Together", "k-ext"), ("Lib.Push · VAPID", "k-app"), ("Fact memory", "k-ext")]]),
    ("L4 · Agents/Apps", ["agent runtime shipped", "apps designed, not built"], False, [
        [("Sessions", "k-app"), ("Residents · triggers", "k-app"), ("Harness · formal", "k-app"), ("Harness · ReAct", "k-app")],
        [("Agent.Tools · gated", "k-app"), ("Approvals · human", "k-app"), ("Elicit · ReqNode", "k-app"), ("Apps · bundles", "k-ext")]]),
    ("L3 · IO", ["via Phoenix endpoint"], False, [[("Phoenix endpoint + router", "k-app"), ("Streaming pipelines", "k-ext"), ("Contract externs", "k-ext")]]),
    ("L2 · Compute", ["proof-bearing layer", "building out"], False, [
        [("Verify · provers", "k-gpu"), ("Spec · IR bridge", "k-gpu"), ("Kernel.Wasm", "k-gpu"), ("Kernel.Executor", "k-gpu")],
        [("Conformance", "k-gpu"), ("Code.Registry", "k-gpu"), ("Process", "k-gpu"), ("Reflect · read-only", "k-gpu")],
        [("Assembly · DAG", "k-gpu"), ("Compose · routines", "k-gpu")]]),
    ("L1 · State", ["shipped"], True, [
        [("Journal", "k-data"), ("Model", "k-data"), ("Corpus", "k-data"), ("Queue", "k-data"), ("Workflow", "k-data"), ("Scheduler", "k-data")],
        [("Lease", "k-data"), ("Idempotency", "k-data"), ("Secrets", "k-data"), ("Tasks", "k-data"), ("Knowledge", "k-ext")]]),
    ("L0 · Core", ["shipped"], True, [
        [("Repo · Schema", "k-data"), ("Store", "k-data"), ("Buffer", "k-data"), ("Logs", "k-data"), ("Telemetry", "k-data"), ("PubSub", "k-data")],
        [("Filesystem", "k-data"), ("Secrets", "k-data"), ("Retry", "k-data"), ("Index", "k-data"), ("Embeddings", "k-data"), ("Cluster", "k-data")]]),
]

out = []
y = 20
pos = {}
body, labels = [], []
for label, status, subst, lines in rows:
    h = 2 * 11 + len(lines) * CH + (len(lines) - 1) * GAP
    pos[label.split(" ")[0]] = (y, h)
    labels.append(f'  <text class="t" x="30" y="{y+24}">{label}</text>')
    ly = y + 40
    for s in status:
        labels.append(f'  <text class="s" x="30" y="{ly}">{s}</text>')
        ly += 15
    if subst:
        labels.append(f'  <text class="m" x="30" y="{ly}" style="fill:var(--c-data)">substrate S: assumed</text>')
        labels.append(f'  <text class="m" x="30" y="{ly+13}" style="fill:var(--c-data)">and monitored</text>')
    body.append(f'  <!-- {label.split(" ")[0]} -->')
    body.append(f'  <rect class="node" x="{X0}" y="{y}" width="{W}" height="{h}" rx="8"/>')
    cy = y + 11
    for line in lines:
        n = len(line)
        # chips in a line share the width of a full row of the widest line in the band
        per = max(len(l) for l in lines)
        cw = (W - 2 * PAD - (per - 1) * GAP) / per
        cx = X0 + PAD
        for text, kind in line:
            body.append(f'  <rect class="node {kind}" x="{cx:.0f}" y="{cy}" width="{cw:.0f}" height="{CH}" rx="6"/>'
                        f'<text class="cl tc" x="{cx+cw/2:.0f}" y="{cy+19}">{text}</text>')
            cx += cw + GAP
        cy += CH + GAP
    y += h + VG

beam_y = y + 0
body.append(f'  <rect class="node k-sys" x="{X0}" y="{beam_y}" width="{W}" height="40" rx="8"/>')
body.append(f'  <text class="t tc" x="{X0+W/2:.0f}" y="{beam_y+25}">BEAM / OTP · Elixir 1.19 / OTP 28 · supervision tree booted in dependency order</text>')
total_h = beam_y + 40 + 24


def band(tag):
    return pos[tag]


ext = []
def ext_box(tag, dy, h, title, sub, kind="k-ext", arrow=True, small=False):
    ty, th = band(tag)
    yy = ty + dy
    ext.append(f'  <rect class="node {kind}" x="930" y="{yy}" width="250" height="{h}" rx="8"/>')
    if small:
        ext.append(f'  <text class="t" x="944" y="{yy+h/2+4:.0f}">{title}</text>')
    else:
        ext.append(f'  <text class="t" x="944" y="{yy+22}">{title}</text><text class="s" x="944" y="{yy+40}">{sub}</text>')
    if arrow:
        ext.append(f'  <path class="edge" d="M930 {yy+h/2:.0f}H900" marker-end="url(#a-lay)"/>')

l6y, l6h = band("L6")
ext_box("L6", 0, l6h, "Claude Code (MCP client)", "Tidewave + /mcp/arcana")
l5y, l5h = band("L5")
ext_box("L5", 12, 30, "Anthropic API · remote", "", small=True)
ext_box("L5", l5h - 42, 30, "Homelab SGLang · local", "", small=True)
l2y, l2h = band("L2")
ext.append(f'  <rect class="zone" x="930" y="{l2y}" width="250" height="{l2h}" rx="8"/>')
ext.append(f'  <text class="z" x="944" y="{l2y+16}">Verification plane</text>')
vp = ["Lean 4 + Mathlib", "F* / Pulse + KaRaMeL → WASM", "Apalache · TLC · Quint", "Z3 solver"]
step = (l2h - 28) / len(vp)
for i, t in enumerate(vp):
    vy = l2y + 24 + i * step
    ext.append(f'  <rect class="node k-gpu" x="944" y="{vy:.0f}" width="222" height="{step-6:.0f}" rx="6"/><text class="cl tc" x="1055" y="{vy+step/2:.0f}">{t}</text>')
ext.append(f'  <path class="edge" d="M930 {l2y+l2h/2:.0f}H900" marker-end="url(#a-lay)"/>')
l0y, l0h = band("L0")
half = (l0h - 22 - 8) / 2
ext.append(f'  <rect class="node k-ext" x="930" y="{l0y+11}" width="250" height="{half:.0f}" rx="8"/><text class="t" x="944" y="{l0y+11+half/2+4:.0f}">YugabyteDB (YSQL)</text>')
ext.append(f'  <path class="edge" d="M930 {l0y+11+half/2:.0f}H900" marker-end="url(#a-lay)"/>')
by = l0y + 11 + half + 8
ext.append(f'  <rect class="node k-ext" x="930" y="{by:.0f}" width="250" height="{half:.0f}" rx="8"/><text class="t" x="944" y="{by+half/2+4:.0f}">S3 / local-FS blob store</text>')
ext.append(f'  <path class="edge" d="M930 {by+half/2:.0f}H900" marker-end="url(#a-lay)"/>')

layers_svg = (f'<svg viewBox="0 0 1200 {total_h}" role="img" aria-label="Arcana layered architecture from L0 Core up to L8 Patterns, with the external verification plane, LLM backends and database">\n'
              '  <defs>\n    <marker id="a-lay" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" class="ah"/></marker>\n  </defs>\n\n'
              '  <!-- left labels -->\n' + "\n".join(labels) + "\n\n" + "\n".join(body) + "\n\n  <!-- right column: externals -->\n" + "\n".join(ext) + "\n</svg>")

# ---------------------------------------------------------------- connections
def box(x, y, w, h, kind, t, s, m):
    return (f'  <rect class="node {kind}" x="{x}" y="{y}" width="{w}" height="{h}" rx="8"/>\n'
            f'  <text class="t" x="{x+14}" y="{y+22}">{t}</text><text class="s" x="{x+14}" y="{y+40}">{s}</text><text class="m" x="{x+14}" y="{y+58}">{m}</text>')

con = []
con.append('''<svg viewBox="0 0 1240 800" role="img" aria-label="Block diagram of Arcana subsystems and their declared dependencies, grouped into L2 compute, L1 state and L0 core, with the process, agent runtime, web and conformance subsystems above">
  <defs>
    <marker id="a-con" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" class="ah"/></marker>
  </defs>

  <!-- top row -->''')
con.append(box(40, 30, 190, 70, "k-app", "Arcana.Process", "typed sandboxed actor host", "deps: Journal · Wasm"))
con.append(box(250, 30, 230, 70, "k-app", "Agent.Sessions · Residents", "agent runtime (L4)", "deps: Journal · Model · Lease"))
con.append(box(500, 30, 220, 70, "k-net", "Arcana.Web", "workspace · admin · DevMCP", "dep: PubSub · calls facades"))
con.append(box(725, 30, 215, 70, "k-sys", "Arcana.Conformance", "substrate-assumption monitors", "deps: Telemetry · PubSub"))
con.append('''  <rect class="node k-ext" x="960" y="30" width="240" height="70" rx="8"/>
  <text class="t" x="974" y="52">Pure libraries (no process)</text><text class="s" x="974" y="70">Spec · Elicit · Assembly · Reflect</text><text class="s" x="974" y="86">Agent.Tools · Lib.* · Schema</text>
''')
# L2
con.append('''  <!-- L2 -->
  <rect class="zone" x="40" y="170" width="1140" height="130" rx="10"/>
  <text class="z te" x="1166" y="188">L2 · Compute (proof-bearing)</text>''')
l2 = [("Kernel.Wasm", "wasmtime worker pool", 60), ("Verify", "Lean · F* · Z3 daemons", 230), ("Kernel.Executor", "effect-plan interpreter", 400),
      ("Compose", "goal → routine planning", 570), ("Code.Registry", "hash-keyed kernels", 740)]
for t, s, x in l2:
    con.append(f'  <rect class="node k-gpu" x="{x}" y="210" width="150" height="50" rx="6"/><text class="t" x="{x+12}" y="230">{t}</text><text class="s" x="{x+12}" y="248">{s}</text>')
con.append('  <path class="edge" d="M570 235H550" marker-end="url(#a-con)"/>\n  <path class="edge" d="M720 235H740" marker-end="url(#a-con)"/>')

# L1: 9 boxes
con.append('''
  <!-- L1 -->
  <rect class="zone" x="40" y="370" width="1140" height="130" rx="10"/>
  <text class="z te" x="1166" y="388">L1 · State (substrate S, Repo-backed)</text>''')
l1 = ["Lease", "Scheduler", "Tasks", "Model", "Corpus", "Journal", "Workflow", "Idempotency", "Queue"]
bw, bg = 108, 14
xs = {}
for i, n in enumerate(l1):
    x = 60 + i * (bw + bg)
    xs[n] = x
    con.append(f'  <rect class="node k-data" x="{x}" y="410" width="{bw}" height="46" rx="6"/><text class="t tc" x="{x+bw/2:.0f}" y="438">{n}</text>')
def right(n): return xs[n] + bw
def left(n): return xs[n]
edges = [("Scheduler", "Lease"), ("Tasks", "Scheduler"), ("Tasks", "Model"), ("Corpus", "Journal"), ("Workflow", "Journal"), ("Workflow", "Idempotency")]
for a, b in edges:
    if xs[a] > xs[b]:
        con.append(f'  <path class="edge" d="M{left(a)} 433H{right(b)}" marker-end="url(#a-con)"/>')
    else:
        con.append(f'  <path class="edge" d="M{right(a)} 433H{left(b)}" marker-end="url(#a-con)"/>')
cx = {n: xs[n] + bw / 2 for n in l1}
bus_names = [n for n in l1 if n != "Tasks"]
con.append('  <!-- Repo bus -->')
con.append('  <path class="edge" d="' + "".join(f'M{cx[n]:.0f} 456V478' for n in bus_names) + '" style="stroke-width:1.2"/>')
con.append(f'  <path class="bus" d="M{cx[bus_names[0]]:.0f} 478H{cx[bus_names[-1]]:.0f}"/>')
con.append('  <text class="m" x="60" y="494">every L1 store but Tasks depends on Core.Repo</text>')

# L0
con.append('''
  <!-- L0 -->
  <rect class="zone" x="40" y="560" width="1140" height="156" rx="10"/>
  <text class="z te" x="1166" y="578">L0 · Core (substrate S)</text>
  <rect class="node k-data" x="60" y="592" width="120" height="46" rx="6"/><text class="t tc" x="120" y="620">Buffer</text>
  <rect class="node k-data" x="198" y="592" width="120" height="46" rx="6"/><text class="t tc" x="258" y="620">Logs</text>
  <rect class="node k-data" x="336" y="592" width="120" height="46" rx="6"/><text class="t tc" x="396" y="620">Store</text>
  <rect class="node k-data" x="474" y="592" width="120" height="46" rx="6"/><text class="t tc" x="534" y="620">Filesystem</text>
  <rect class="node k-data" x="650" y="592" width="120" height="46" rx="6"/><text class="t tc" x="710" y="620">Secrets</text>
  <rect class="node k-data" x="788" y="592" width="120" height="46" rx="6"/><text class="t tc" x="848" y="620">Repo</text>
  <rect class="node k-data" x="926" y="592" width="120" height="46" rx="6"/><text class="t tc" x="986" y="620">Index</text>
  <path class="edge" d="M198 615H180" marker-end="url(#a-con)"/>
  <path class="edge" d="M318 615H336" marker-end="url(#a-con)"/>
  <path class="edge" d="M456 615H474" marker-end="url(#a-con)"/>
  <path class="edge" d="M788 615H770" marker-end="url(#a-con)"/>
  <path class="edge" d="M926 615H908" marker-end="url(#a-con)"/>
  <rect class="node k-sys" x="60" y="654" width="1100" height="46" rx="6"/>
  <text class="t" x="76" y="674">Core.Telemetry + Core.PubSub</text><text class="s" x="76" y="691">every subsystem above depends on both; those edges are omitted for clarity</text>

  <!-- BEAM -->
  <rect class="node k-sys" x="40" y="730" width="1140" height="40" rx="8"/>
  <text class="t tc" x="610" y="755">BEAM / OTP · boot order = topological sort of Subsystem.dependencies/0 (cycles and missing deps fail at boot)</text>
''')
# top-row arrows
con.append(f'''  <!-- top row arrows -->
  <path class="edge" d="M135 100V210" marker-end="url(#a-con)"/><text class="m te" x="127" y="150">Kernel.Wasm</text>
  <path class="edge" d="M215 100V370" marker-end="url(#a-con)"/><text class="m" x="223" y="345">Journal</text>
  <path class="edge" d="M390 100V370" marker-end="url(#a-con)"/><text class="m" x="398" y="140">Journal · Model</text><text class="m" x="398" y="153">Lease · Scheduler</text>
  <path class="edge dash" d="M560 100V170" marker-end="url(#a-con)"/><text class="m" x="568" y="140">calls facades</text>
  <path class="edge dash" d="M730 100V370" marker-end="url(#a-con)"/><text class="m" x="738" y="140">monitors</text>
  <path class="edge dash" d="M1010 100V170" marker-end="url(#a-con)"/><text class="m" x="1018" y="140">use L2 facades</text>

  <!-- L2 -> L1 -->
  <path class="edge" d="M450 260L{cx['Scheduler']:.0f} 410" marker-end="url(#a-con)"/>
  <path class="edge" d="M510 260L{cx['Journal']-20:.0f} 410" marker-end="url(#a-con)"/>
  <path class="edge" d="M770 260L{cx['Model']+10:.0f} 410" marker-end="url(#a-con)"/>
  <path class="edge" d="M800 260L{cx['Journal']+20:.0f} 410" marker-end="url(#a-con)"/>
  <!-- L1 -> L0 -->
  <path class="edge" d="M{cx['Journal']-10:.0f} 456L420 592" marker-end="url(#a-con)"/>
  <path class="edge" d="M{cx['Corpus']+30:.0f} 456L970 592" marker-end="url(#a-con)"/>
  <path class="edge" d="M{cx['Workflow']:.0f} 478V592" marker-end="url(#a-con)"/>
</svg>''')
connections_svg = "\n".join(con)

# ---------------------------------------------------------------- splice
src = open(TPL).read()
src = re.sub(r'<svg viewBox="0 0 1200 \d+" role="img" aria-label="Arcana layered.*?</svg>', lambda m: layers_svg, src, count=1, flags=re.S)
src = re.sub(r'<svg viewBox="0 0 1240 \d+" role="img" aria-label="Block diagram of Arcana.*?</svg>', lambda m: connections_svg, src, count=1, flags=re.S)
open(TPL, "w").write(src)
print("layers height", total_h)
