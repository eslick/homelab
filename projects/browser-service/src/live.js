import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import { audit } from './audit.js';
import { config } from './config.js';
import { viewerHtml } from './live-page.js';
import { notify } from './notify.js';
import * as profiles from './profiles.js';
import { manager } from './sessions.js';

// Human handoff: the agent asks the operator to take over a session (login, 2FA, captcha). The operator
// gets a Discord link to /live/<id>?t=<token>, sees the page via CDP screencast, drives it with mouse and
// keyboard, and presses Done; the resulting cookies/localStorage are saved to the profile.
// The token is scoped to one handoff and dies when it ends. Key/text events are never logged.

const handoffs = new Map();
const changed = new EventEmitter();
const sha = (s) => crypto.createHash('sha256').update(s).digest();
const FINAL_RETENTION_MS = 3600_000;

export function describe(h, { withUrl = false } = {}) {
  return {
    handoff_id: h.id,
    status: h.status,
    session: h.sessionId,
    profile: h.profile,
    expires_at: new Date(h.expiresAt).toISOString(),
    notified: h.notified,
    ...(withUrl && { url: h.url }),
  };
}

export async function requestHuman(session, reason, { sendNotification = true } = {}) {
  if (session.handoff?.status === 'pending') return session.handoff;
  const id = crypto.randomBytes(8).toString('hex');
  const token = crypto.randomBytes(24).toString('base64url');
  const h = {
    id,
    sessionId: session.id,
    profile: session.profileId,
    reason: String(reason).slice(0, 300),
    status: 'pending',
    tokenHash: sha(token),
    url: `${config.publicUrl || ''}/live/${id}?t=${token}`,
    expiresAt: Date.now() + config.handoffTtlS * 1000,
    viewers: new Set(),
    notified: false,
  };
  handoffs.set(id, h);
  session.handoff = h;
  session.lastHandoff = h;
  h.timer = setTimeout(() => finish(h, 'expired'), config.handoffTtlS * 1000);
  session.events.once('closed', () => finish(h, 'cancelled'));
  audit('handoff.request', { handoff: id, session: session.id, profile: session.profileId });
  if (sendNotification) {
    h.notified = await notify(
      `Browser needs you: ${h.reason}${session.profileId ? ` (profile: ${session.profileId})` : ''}\n${h.url}\nExpires in ${Math.round(config.handoffTtlS / 60)} min.`,
    );
  }
  return h;
}

export async function finish(h, status) {
  if (h.status !== 'pending') return;
  h.status = status;
  clearTimeout(h.timer);
  const session = manager.sessions.get(h.sessionId);
  if (status === 'done' && session) {
    try {
      await profiles.saveState(session);
    } catch (e) {
      audit('handoff.save_failed', { handoff: h.id, error: e.message });
    }
  }
  if (session?.handoff === h) session.handoff = null;
  for (const ws of h.viewers) ws.close(1000, status);
  audit('handoff.finish', { handoff: h.id, session: h.sessionId, status });
  changed.emit(h.id);
  setTimeout(() => handoffs.delete(h.id), FINAL_RETENTION_MS).unref();
}

/** Resolve with the handoff's status as soon as it is no longer pending, or after timeoutMs. */
export function waitHuman(h, timeoutMs) {
  if (h.status !== 'pending') return Promise.resolve(h.status);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      resolve(h.status);
    };
    const t = setTimeout(() => {
      changed.off(h.id, done);
      resolve(h.status);
    }, timeoutMs);
    changed.once(h.id, done);
  });
}

function authorize(id, token) {
  const h = handoffs.get(id);
  if (!h || h.status !== 'pending' || !token) return null;
  return crypto.timingSafeEqual(sha(token), h.tokenHash) ? h : null;
}

const SECURITY_HEADERS = () => ({
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:; connect-src 'self' ws: wss:; frame-ancestors 'self' ${config.frameAncestors.join(' ')}`.trim(),
});

/** GET /live/:id?t=… → the viewer page. */
export function servePage(req, res, id, token) {
  const h = authorize(id, token);
  if (!h) {
    res.writeHead(403, { 'content-type': 'text/plain', ...SECURITY_HEADERS() });
    return res.end('This link is invalid or has expired.');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS() });
  res.end(viewerHtml({ reason: h.reason, profile: h.profile }));
}

// ---- websocket viewer: CDP screencast out, input events in ----

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

export function handleUpgrade(req, socket, head) {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/live\/([0-9a-f]+)\/ws$/);
  const h = m && authorize(m[1], url.searchParams.get('t'));
  if (!h || !manager.sessions.has(h.sessionId)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => attach(ws, h, manager.sessions.get(h.sessionId)));
}

function attach(ws, h, session) {
  h.viewers.add(ws);
  let cdp = null;
  let queue = Promise.resolve();
  const sendJson = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));

  const stop = async () => {
    const c = cdp;
    cdp = null;
    if (!c) return;
    await c.send('Page.stopScreencast').catch(() => {});
    await c.detach().catch(() => {});
  };
  const start = async () => {
    await stop();
    const page = session.page;
    if (!page) return;
    const c = await session.context.newCDPSession(page);
    cdp = c;
    c.on('Page.screencastFrame', ({ data, sessionId }) => {
      if (ws.bufferedAmount < 1_500_000) ws.send(Buffer.concat([Buffer.from([1]), Buffer.from(data, 'base64')]), { binary: true });
      c.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await c.send('Page.startScreencast', { format: 'jpeg', quality: 60, everyNthFrame: 1 });
  };
  const meta = async () => sendJson({ type: 'meta', url: session.page?.url() ?? '', tabs: session.pages.length });

  start().catch((e) => sendJson({ type: 'error', message: e.message }));
  session.events.on('pages', start);
  const ticker = setInterval(meta, 1000);

  const handle = async (msg) => {
    const page = session.page;
    if (!page) return;
    session.touch();
    switch (msg.t) {
      case 'mouse':
        if (msg.a === 'wheel') {
          await page.mouse.move(msg.x, msg.y);
          await page.mouse.wheel(msg.dx ?? 0, msg.dy ?? 0);
        } else if (msg.a === 'move') await page.mouse.move(msg.x, msg.y);
        else if (msg.a === 'down') {
          await page.mouse.move(msg.x, msg.y);
          await page.mouse.down({ button: msg.button ?? 'left', clickCount: msg.clicks ?? 1 });
        } else if (msg.a === 'up') await page.mouse.up({ button: msg.button ?? 'left', clickCount: msg.clicks ?? 1 });
        break;
      case 'key':
        if (msg.a === 'down') await page.keyboard.down(String(msg.key));
        else if (msg.a === 'up') await page.keyboard.up(String(msg.key));
        else if (msg.a === 'press') await page.keyboard.press(String(msg.key));
        break;
      case 'text':
        await page.keyboard.insertText(String(msg.text));
        break;
      case 'nav':
        await page.goto(String(msg.url), { waitUntil: 'domcontentloaded', timeout: 30000 });
        break;
      case 'done':
        await finish(h, 'done');
        break;
      case 'cancel':
        await finish(h, 'cancelled');
        break;
    }
  };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // Serialise so a click's down/up and typed keys keep their order.
    queue = queue.then(() => handle(msg)).catch((e) => sendJson({ type: 'error', message: String(e.message).split('\n')[0] }));
  });
  ws.on('close', () => {
    h.viewers.delete(ws);
    clearInterval(ticker);
    session.events.off('pages', start);
    stop();
  });
}
