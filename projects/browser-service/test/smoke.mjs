// End-to-end smoke test. Runs INSIDE the service container (see README "Testing"):
// starts a fixture site on :9911, then drives the service over REST and MCP.
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = 'http://127.0.0.1:8931';
const H = { authorization: `Bearer ${process.env.BROWSER_SERVICE_TOKEN}`, 'content-type': 'application/json' };
const api = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: H, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const tool = (id, name, args = {}) => api('POST', `/v1/sessions/${id}/tools/${name}`, args);
const textOf = (r) => r.body.content.map((c) => c.text ?? '').join('\n');

// --- fixture: login form -> cookie -> /home ; /home 'Welcome' when cookie present
const notices = [];
const fixture = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  if (req.url === '/discord-webhook' && req.method === 'POST') {
    let b = '';
    return req.on('data', (d) => (b += d)).on('end', () => (notices.push(JSON.parse(b)), res.writeHead(204).end()));
  }
  const authed = /sid=ok/.test(req.headers.cookie ?? '');
  if (req.url === '/login' && req.method === 'GET')
    return res.end('<form method=post action=/login><input name=email><input type=password name=pw><button type=submit>Go</button></form>');
  if (req.url === '/login' && req.method === 'POST') {
    let b = '';
    req.on('data', (d) => (b += d)).on('end', () => {
      const ok = b.includes('email=me%40x.test') && b.includes('pw=s3cret');
      res.writeHead(302, { location: '/home', ...(ok && { 'set-cookie': 'sid=ok; Path=/' }) }).end();
    });
    return;
  }
  if (req.url === '/emu')
    return res.end(`<canvas id=c width=200 height=100 style="display:block"></canvas><iframe id=f src=/inner width=200 height=60></iframe>
<script>window.ev=[];for(const t of ['mousedown','mouseup','click'])c.addEventListener(t,e=>ev.push(t+':'+e.offsetX+','+e.offsetY));
c.addEventListener('wheel',e=>ev.push('wheel:'+e.deltaY));</script>`);
  if (req.url === '/inner') return res.end('<button onclick="document.title=\'clicked\'">Inner</button>');
  if (req.url === '/home')
    return res.end(authed ? '<h1>Welcome</h1><script>console.error("boom")</script><button id=b>Hit</button>' : '<h1>Please sign in</h1>');
  res.writeHead(404).end();
});
await new Promise((r) => fixture.listen(9911, '0.0.0.0', r));

let pass = 0;
const ok = (name) => console.log(`ok - ${name}`, ++pass && '');

// healthz open, everything else needs the token
assert.equal((await fetch(BASE + '/healthz')).status, 200);
assert.equal((await fetch(BASE + '/v1/sessions')).status, 401);
ok('auth');

const profs = (await api('GET', '/v1/profiles')).body;
assert.ok(profs.find((p) => p.id === 'fixture' && p.has_credentials));
assert.ok(!JSON.stringify(profs).includes('s3cret'), 'profile listing must not leak secrets');
ok('profiles listing has no secrets');

// credentialed profile: auto-login on create
let r = await api('POST', '/v1/sessions', { profile: 'fixture' });
assert.equal(r.status, 201, JSON.stringify(r.body));
const sid = r.body.id;
r = await tool(sid, 'navigate', { url: 'http://localhost:9911/home' });
assert.match(textOf(r), /Welcome|home/);
assert.match(textOf(await tool(sid, 'get_text')), /Welcome/);
ok('auto-login via stored credentials');

assert.match(textOf(await tool(sid, 'snapshot')), /ref=\w+/);
ok('snapshot has refs');
assert.match(textOf(await tool(sid, 'console_messages', { level: 'error' })), /boom/);
ok('console capture');
assert.equal((await tool(sid, 'screenshot')).body.content[0].type, 'image');
ok('screenshot');

// policy: off-profile host, and a private address not on the allow list
r = await tool(sid, 'navigate', { url: 'http://127.0.0.1:9911/home' });
assert.ok(r.status >= 400, 'navigation off allowed_hosts must fail');
assert.match(textOf(await tool(sid, 'network_log')), /not in profile allowed_hosts/);
ok('navigation allowlist enforced');
assert.equal((await tool(sid, 'evaluate', { expression: '1+1' })).status >= 400, true);
ok('evaluate disabled for credentialed profile');

// saved state is reused by a second session without logging in again
await api('DELETE', `/v1/sessions/${sid}`);
r = await api('POST', '/v1/sessions', { profile: 'fixture', login: false });
const sid2 = r.body.id;
await tool(sid2, 'navigate', { url: 'http://localhost:9911/home' });
assert.match(textOf(await tool(sid2, 'get_text')), /Welcome/);
ok('saved state reused');
await api('DELETE', `/v1/sessions/${sid2}`);

// ephemeral session: private ranges blocked, public ok-ish, evaluate allowed
r = await api('POST', '/v1/sessions', {});
const sid3 = r.body.id;
r = await tool(sid3, 'navigate', { url: 'http://169.254.169.254/' });
assert.ok(r.status >= 400);
r = await tool(sid3, 'navigate', { url: 'http://127.0.0.1:8931/healthz' });
assert.ok(r.status >= 400, 'control API must be unreachable from the browser');
ok('private ranges blocked');
assert.match(textOf(await tool(sid3, 'evaluate', { expression: '1+1' })), /2/);
await api('DELETE', `/v1/sessions/${sid3}`);

// session cap
const ids = [];
for (let i = 0; i < 4; i++) ids.push((await api('POST', '/v1/sessions', {})).body.id);
assert.equal((await api('POST', '/v1/sessions', {})).status, 500);
for (const id of ids) await api('DELETE', `/v1/sessions/${id}`);
ok('session limit');

// MCP: tools list, lazy session, console on fixture, close on disconnect
const client = new Client({ name: 'smoke', version: '0' });
const transport = new StreamableHTTPClientTransport(new URL(BASE + '/mcp?profile=fixture'), { requestInit: { headers: { authorization: H.authorization } } });
await client.connect(transport);
const listed = await client.listTools();
assert.ok(listed.tools.some((t) => t.name === 'snapshot'));
await client.callTool({ name: 'navigate', arguments: { url: 'http://localhost:9911/home' } });
const t = await client.callTool({ name: 'get_text', arguments: {} });
assert.match(t.content[0].text, /Welcome/);
assert.equal((await api('GET', '/v1/sessions')).body.length, 1);
await transport.terminateSession(); // explicit DELETE; clients that just drop the connection rely on the idle TTL
await client.close();
await new Promise((r) => setTimeout(r, 1500));
assert.equal((await api('GET', '/v1/sessions')).body.length, 0, 'MCP disconnect closes its session');
ok('mcp');

// ---- emulation (viewport, colour scheme) on REST and /mcp; pointer tool; iframe selectors
{
  const bad = await api('POST', '/v1/sessions', { color_scheme: 'purple' });
  assert.equal(bad.status, 400);
  const e = await api('POST', '/v1/sessions', { viewport: '390x844', color_scheme: 'dark', reduced_motion: 'reduce', has_touch: true });
  assert.equal(e.status, 201);
  await tool(e.body.id, 'navigate', { url: 'http://localhost:9911/emu' });
  const probe = JSON.parse(JSON.parse(textOf(await tool(e.body.id, 'evaluate', { expression: "JSON.stringify({w:innerWidth,dark:matchMedia('(prefers-color-scheme: dark)').matches,rm:matchMedia('(prefers-reduced-motion: reduce)').matches,gl:!!document.createElement('canvas').getContext('webgl2')})" }))));
  assert.deepEqual([probe.w, probe.dark, probe.rm], [390, true, true]);
  assert.equal(probe.gl, true, 'webgl2 available');
  await tool(e.body.id, 'set_color_scheme', { color_scheme: 'light' });
  assert.match(textOf(await tool(e.body.id, 'evaluate', { expression: "matchMedia('(prefers-color-scheme: dark)').matches" })), /false/);
  await api('DELETE', `/v1/sessions/${e.body.id}`);

  const ec = new Client({ name: 'emu', version: '0' });
  const et = new StreamableHTTPClientTransport(new URL(BASE + '/mcp?viewport=390x844&color_scheme=dark'), { requestInit: { headers: { authorization: H.authorization } } });
  await ec.connect(et);
  assert.ok((await ec.listTools()).tools.some((t) => t.name === 'pointer'));
  const call = (name, args) => ec.callTool({ name, arguments: args });
  await call('navigate', { url: 'http://localhost:9911/emu' });
  const mp = JSON.parse(JSON.parse((await call('evaluate', { expression: "JSON.stringify({w:innerWidth,dark:matchMedia('(prefers-color-scheme: dark)').matches})" })).content[0].text));
  assert.deepEqual(mp, { w: 390, dark: true });
  await call('pointer', { action: 'click', selector: '#c' });
  await call('pointer', { action: 'click', selector: '#c', offset_x: 10, offset_y: 20 });
  await call('pointer', { action: 'wheel', selector: '#c', delta_y: 120 });
  const evs = JSON.parse(JSON.parse((await call('evaluate', { expression: 'JSON.stringify(ev)' })).content[0].text));
  assert.deepEqual(evs.slice(0, 3), ['mousedown:100,50', 'mouseup:100,50', 'click:100,50']);
  assert.ok(evs.includes('click:10,20') && evs.includes('wheel:120'), evs.join());
  await call('click', { selector: '#c', position: { x: 5, y: 6 } });
  assert.ok(JSON.parse(JSON.parse((await call('evaluate', { expression: 'JSON.stringify(ev)' })).content[0].text)).includes('click:5,6'));
  const fr = await call('click', { selector: '#f >> internal:control=enter-frame >> button' });
  assert.ok(!fr.isError, JSON.stringify(fr));
  await et.terminateSession();
  await ec.close();
  await new Promise((r) => setTimeout(r, 1500));
}
ok('viewport/colour scheme/pointer/iframe');

// ---- identity: looks like an ordinary browser
r = await api('POST', '/v1/sessions', { profile: 'manual' });
const hs = r.body.id;
await tool(hs, 'navigate', { url: 'http://localhost:9911/login' });
const ident = JSON.parse(JSON.parse(textOf(await tool(hs, 'evaluate', { expression: 'JSON.stringify({ua:navigator.userAgent,wd:navigator.webdriver,tz:Intl.DateTimeFormat().resolvedOptions().timeZone,lang:navigator.language})' }))));
assert.ok(!/Headless/.test(ident.ua), ident.ua);
assert.equal(ident.wd, false);
assert.equal(ident.tz, 'America/Los_Angeles');
ok('browser identity looks ordinary');

// ---- human handoff: credential-less profile, operator signs in through the live view
const lr = await tool(hs, 'login');
assert.ok(lr.status >= 400 && /request_human/.test(JSON.stringify(lr.body)));
await tool(hs, 'navigate', { url: 'http://localhost:9911/login' }); // the login check left us on /home
r = await tool(hs, 'request_human', { reason: 'Sign in to the fixture' });
const rh = JSON.parse(textOf(r));
assert.equal(rh.status, 'pending');
assert.equal(rh.notified, true);
assert.equal(rh.url, undefined, 'link is only returned when the notification failed');
assert.equal(notices.length, 1);
assert.match(notices[0].content, /Sign in to the fixture/);
assert.deepEqual(notices[0].allowed_mentions, { parse: [] });
const link = notices[0].content.match(/https?:\/\/\S+\/live\/\S+/)[0];
const lu = new URL(link);
let pg = await fetch(link);
assert.equal(pg.status, 200);
assert.match(pg.headers.get('content-security-policy'), /frame-ancestors 'self' https:\/\/arcana\.test/);
assert.equal((await fetch(lu.origin + lu.pathname + '?t=wrong')).status, 403);
await assert.rejects(new Promise((res, rej) => { const w = new WebSocket(`ws://127.0.0.1:8931${lu.pathname}/ws?t=wrong`); w.on('open', res); w.on('error', rej); }));
ok('live link: page served with frame-ancestors, bad token rejected');

const ws = new WebSocket(`ws://127.0.0.1:8931${lu.pathname}/ws${lu.search}`);
let frames = 0;
ws.on('message', (d, bin) => bin && d[0] === 1 && frames++);
await new Promise((res, rej) => (ws.on('open', res), ws.on('error', rej)));
const send = (o) => ws.send(JSON.stringify(o));
const sleep = (ms) => new Promise((r2) => setTimeout(r2, ms));
await sleep(1500);
assert.ok(frames > 0, 'screencast frames arrive');
ok('screencast frames');

const box = async (sel) => JSON.parse(JSON.parse(textOf(await tool(hs, 'evaluate', { expression: `JSON.stringify((r=>({x:r.x+r.width/2,y:r.y+r.height/2}))(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect()))` }))));
const click = async (sel) => { const b = await box(sel); send({ t: 'mouse', a: 'down', x: b.x, y: b.y }); send({ t: 'mouse', a: 'up', x: b.x, y: b.y }); await sleep(150); };
await click('input[name=email]');
for (const ch of 'me@x.test') { send({ t: 'key', a: 'down', key: ch }); send({ t: 'key', a: 'up', key: ch }); }
await click('input[name=pw]');
send({ t: 'text', text: 's3cret' }); // paste path
await sleep(300);
await click('button[type=submit]');
await sleep(1500);
assert.match(textOf(await tool(hs, 'get_text')), /Welcome/);
ok('human input (mouse, keys, paste) signs in through the live view');

send({ t: 'done' });
r = await tool(hs, 'await_human', { timeout_s: 10 });
assert.equal(JSON.parse(textOf(r)).status, 'done');
await api('DELETE', `/v1/sessions/${hs}`);
// state captured: a new session on the profile is already logged in; login verifies it
r = await api('POST', '/v1/sessions', { profile: 'manual' });
const hs2 = r.body.id;
assert.equal(JSON.parse(textOf(await tool(hs2, 'login'))).status, 'already_logged_in');
await api('DELETE', `/v1/sessions/${hs2}`);
ok('handoff done captures login for the profile');

// a finished handoff's link is dead
assert.equal((await fetch(link)).status, 403);
// cancel path
r = await api('POST', '/v1/sessions', { profile: 'manual', login: false });
const hs3 = r.body.id;
await tool(hs3, 'request_human', { reason: 'cancel me' });
await api('DELETE', `/v1/sessions/${hs3}`);
ok('handoff cleanup');

console.log(`\n${pass} checks passed`);
process.exit(0);
