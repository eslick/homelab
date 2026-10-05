// End-to-end smoke test. Runs INSIDE the service container (see README "Testing"):
// starts a fixture site on :9911, then drives the service over REST and MCP.
import assert from 'node:assert/strict';
import http from 'node:http';
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
const fixture = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
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

console.log(`\n${pass} checks passed`);
process.exit(0);
