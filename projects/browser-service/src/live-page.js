const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const viewerHtml = ({ reason, profile }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Browser handoff</title>
<style>
  :root { --bg:#f6f6f4; --fg:#1b1b1a; --muted:#6b6b66; --bar:#ffffff; --line:#d9d9d4; --accent:#1a5fb4; --danger:#b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161615; --fg:#ececea; --muted:#9a9a94; --bar:#1f1f1e; --line:#34342f; --accent:#7ab0f5; --danger:#f2867f; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.4 system-ui, sans-serif; }
  header { background:var(--bar); border-bottom:1px solid var(--line); padding:8px 12px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  header .why { flex:1 1 100%; color:var(--muted); }
  header .why b { color:var(--fg); }
  input { font:inherit; color:var(--fg); background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:6px 8px; min-width:0; }
  button { font:inherit; color:var(--fg); background:var(--bar); border:1px solid var(--line); border-radius:6px; padding:6px 10px; cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button.danger { color:var(--danger); }
  #url { flex:1 1 260px; }
  #text { flex:1 1 180px; }
  .row { display:flex; flex-wrap:wrap; gap:6px; flex:1 1 100%; align-items:center; }
  main { padding:10px 12px; }
  canvas { display:block; width:100%; max-width:1280px; height:auto; background:#fff; border:1px solid var(--line); touch-action:none; outline:none; }
  #status { color:var(--muted); padding:6px 12px; }
</style></head>
<body>
<header>
  <div class="why"><b>The agent needs you:</b> ${esc(reason)}${profile ? ` <span>(profile: ${esc(profile)})</span>` : ''}</div>
  <div class="row">
    <input id="url" placeholder="address" autocomplete="off" spellcheck="false">
    <button id="go">Go</button>
    <button id="up" title="scroll up">Up</button><button id="down" title="scroll down">Down</button>
  </div>
  <div class="row">
    <input id="text" placeholder="type or paste text, then Send" autocomplete="off" spellcheck="false">
    <label><input type="checkbox" id="mask"> mask</label>
    <button id="send">Send</button>
    <button data-key="Tab">Tab</button><button data-key="Enter">Enter</button><button data-key="Backspace">Back</button>
  </div>
  <div class="row">
    <button class="primary" id="done">Done, I am signed in</button>
    <button class="danger" id="cancel">Cancel</button>
  </div>
</header>
<div id="status">connecting...</div>
<main><canvas id="cv" tabindex="0" width="1280" height="800"></canvas></main>
<script>
const id = location.pathname.split('/')[2], t = new URLSearchParams(location.search).get('t');
const ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/live/' + id + '/ws?t=' + encodeURIComponent(t));
ws.binaryType = 'arraybuffer';
const cv = document.getElementById('cv'), cx = cv.getContext('2d'), $ = (i) => document.getElementById(i);
const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
let seq = 0;
ws.onopen = () => { $('status').textContent = 'connected'; cv.focus(); };
ws.onclose = (e) => { $('status').textContent = e.reason ? 'finished: ' + e.reason : 'disconnected'; };
ws.onmessage = async (e) => {
  if (typeof e.data === 'string') {
    const m = JSON.parse(e.data);
    if (m.type === 'meta' && document.activeElement !== $('url')) $('url').value = m.url;
    if (m.type === 'error') $('status').textContent = m.message;
    return;
  }
  const u = new Uint8Array(e.data), mine = ++seq;
  if (u[0] !== 1) return;
  const bmp = await createImageBitmap(new Blob([u.subarray(1)], { type: 'image/jpeg' }));
  if (mine !== seq) return;
  cv.width = bmp.width; cv.height = bmp.height; cx.drawImage(bmp, 0, 0);
};
const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: Math.round((e.clientX - r.left) * cv.width / r.width), y: Math.round((e.clientY - r.top) * cv.height / r.height) }; };
const btn = (e) => (e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left');
let touch = null, lastMove = 0;
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('pointerdown', (e) => {
  cv.focus(); cv.setPointerCapture(e.pointerId);
  if (e.pointerType === 'touch') { touch = { x: e.clientX, y: e.clientY, moved: false, p: pos(e) }; return; }
  send({ t: 'mouse', a: 'down', button: btn(e), clicks: e.detail || 1, ...pos(e) });
});
cv.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'touch') {
    if (touch && !touch.moved) { send({ t: 'mouse', a: 'down', ...touch.p }); send({ t: 'mouse', a: 'up' }); }
    touch = null; return;
  }
  send({ t: 'mouse', a: 'up', button: btn(e), clicks: e.detail || 1 });
});
cv.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') {
    if (!touch) return;
    const dx = touch.x - e.clientX, dy = touch.y - e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 8) { touch.moved = true; send({ t: 'mouse', a: 'wheel', dx, dy, ...touch.p }); touch.x = e.clientX; touch.y = e.clientY; }
    return;
  }
  const n = Date.now(); if (n - lastMove < 40) return; lastMove = n;
  send({ t: 'mouse', a: 'move', ...pos(e) });
});
cv.addEventListener('wheel', (e) => { e.preventDefault(); send({ t: 'mouse', a: 'wheel', dx: e.deltaX, dy: e.deltaY, ...pos(e) }); }, { passive: false });
const ignore = new Set(['Dead', 'Unidentified', 'Process']);
cv.addEventListener('keydown', (e) => { if (ignore.has(e.key)) return; e.preventDefault(); send({ t: 'key', a: 'down', key: e.key }); });
cv.addEventListener('keyup', (e) => { if (ignore.has(e.key)) return; e.preventDefault(); send({ t: 'key', a: 'up', key: e.key }); });
$('go').onclick = () => { let u = $('url').value.trim(); if (u && !/^[a-z]+:/i.test(u)) u = 'https://' + u; send({ t: 'nav', url: u }); };
$('url').onkeydown = (e) => { if (e.key === 'Enter') $('go').click(); };
$('send').onclick = () => { const v = $('text').value; if (v) send({ t: 'text', text: v }); $('text').value = ''; cv.focus(); };
$('text').onkeydown = (e) => { if (e.key === 'Enter') $('send').click(); };
$('mask').onchange = (e) => { $('text').type = e.target.checked ? 'password' : 'text'; };
document.querySelectorAll('[data-key]').forEach((b) => (b.onclick = () => { send({ t: 'key', a: 'press', key: b.dataset.key }); cv.focus(); }));
$('up').onclick = () => send({ t: 'mouse', a: 'wheel', dx: 0, dy: -400, x: 640, y: 400 });
$('down').onclick = () => send({ t: 'mouse', a: 'wheel', dx: 0, dy: 400, x: 640, y: 400 });
$('done').onclick = () => { send({ t: 'done' }); };
$('cancel').onclick = () => { send({ t: 'cancel' }); };
</script></body></html>`;
