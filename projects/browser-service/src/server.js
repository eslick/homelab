import crypto from 'node:crypto';
import http from 'node:http';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { audit } from './audit.js';
import { config } from './config.js';
import { handleUpgrade, servePage } from './live.js';
import { handleMcp } from './mcp.js';
import * as profiles from './profiles.js';
import { manager } from './sessions.js';
import { argsSchema, runTool, tools } from './tools.js';

const tokenBuf = Buffer.from(config.apiToken);
function authorized(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!m) return false;
  const given = Buffer.from(m[1]);
  return given.length === tokenBuf.length && crypto.timingSafeEqual(given, tokenBuf);
}

async function readJson(req, limit = 5_000_000) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    if ((n += c.length) > limit) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  if (!n) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const m = req.method;

  if (p === '/healthz') return send(res, 200, { ok: true, sessions: manager.sessions.size });
  let live;
  if (m === 'GET' && (live = p.match(/^\/live\/([0-9a-f]+)$/))) return servePage(req, res, live[1], url.searchParams.get('t'));
  if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });

  if (p === '/mcp') return handleMcp(req, res, m === 'POST' ? await readJson(req) : undefined, url);

  if (p === '/v1/tools' && m === 'GET') {
    return send(res, 200, tools.map((t) => ({ name: t.name, description: t.description, input_schema: zodToJsonSchema(argsSchema(t), { $refStrategy: 'none' }) })));
  }
  if (p === '/v1/profiles' && m === 'GET') return send(res, 200, profiles.listProfiles());

  let g;
  if ((g = p.match(/^\/v1\/profiles\/([^/]+)\/state$/))) {
    if (m === 'PUT') {
      profiles.importState(g[1], await readJson(req, 20_000_000));
      audit('profile.import_state', { profile: g[1] });
      return send(res, 200, { ok: true });
    }
    if (m === 'DELETE') {
      profiles.forgetState(g[1]);
      audit('profile.forget_state', { profile: g[1] });
      return send(res, 200, { ok: true });
    }
  }

  if (p === '/v1/sessions' && m === 'GET') return send(res, 200, manager.list());
  if (p === '/v1/sessions' && m === 'POST') {
    const b = (await readJson(req)) ?? {};
    const s = await manager.create({ profile: b.profile, ttlS: b.ttl_s, label: b.label, viewport: b.viewport, login: b.login ?? true, persist: b.persist ?? true });
    return send(res, 201, s.info());
  }
  if ((g = p.match(/^\/v1\/sessions\/([0-9a-f]+)$/))) {
    if (m === 'GET') return send(res, 200, manager.get(g[1]).info());
    if (m === 'DELETE') return send(res, 200, { closed: await manager.close(g[1]) });
  }
  if ((g = p.match(/^\/v1\/sessions\/([0-9a-f]+)\/tools\/([a-z_]+)$/)) && m === 'POST') {
    const content = await runTool(manager.get(g[1]), g[2], await readJson(req));
    return send(res, 200, { content });
  }
  return send(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    const status = e.status ?? (e.name === 'ZodError' ? 400 : /unknown (profile|tool)|no such/.test(e.message) ? 404 : 500);
    if (!res.headersSent) send(res, status, { error: e.name === 'ZodError' ? 'invalid arguments' : e.message, ...(e.issues && { issues: e.issues }) });
    else res.end();
  });
});

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/live/')) return handleUpgrade(req, socket, head);
  socket.destroy();
});

server.listen(config.port, '0.0.0.0', () => audit('server.start', { port: config.port, max_sessions: config.maxSessions }));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    await manager.closeAll();
    process.exit(0);
  });
}
