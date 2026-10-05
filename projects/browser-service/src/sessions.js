import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chromium } from 'playwright-core';
import { audit } from './audit.js';
import { config } from './config.js';
import * as guard from './guard.js';
import * as profiles from './profiles.js';

const BUF_CAP = 500;
const push = (arr, item) => {
  arr.push(item);
  if (arr.length > BUF_CAP) arr.shift();
};

export class Session {
  constructor(id, opts) {
    Object.assign(this, opts, { id, createdAt: Date.now(), lastUsed: Date.now(), busy: false });
    this.events = new EventEmitter(); // 'pages' (tab set/current changed), 'closed'
    this.handoff = null;              // pending human handoff, see live.js
    this.console = [];
    this.network = [];
    this.blocked = [];
  }

  get page() {
    return this.pages[this.current] ?? this.pages[0];
  }

  touch() {
    this.lastUsed = Date.now();
  }

  expiresAt() {
    return Math.min(this.lastUsed + this.ttlS * 1000, this.createdAt + config.maxTtlS * 1000);
  }

  info() {
    return {
      id: this.id,
      label: this.label,
      profile: this.profileId ?? null,
      created_at: new Date(this.createdAt).toISOString(),
      expires_at: new Date(this.expiresAt()).toISOString(),
      url: this.page?.url() ?? null,
      tabs: this.pages.length,
      allow_evaluate: this.allowEvaluate,
      handoff: this.handoff?.id ?? null,
    };
  }

  watchPage(page) {
    this.pages.push(page);
    this.current = this.pages.length - 1;
    this.events.emit('pages');
    const where = () => page.url();
    page.on('console', (m) => push(this.console, { t: Date.now(), type: m.type(), text: m.text(), url: where() }));
    page.on('pageerror', (e) => push(this.console, { t: Date.now(), type: 'pageerror', text: String(e.stack ?? e), url: where() }));
    page.on('requestfailed', (r) => push(this.network, { t: Date.now(), method: r.method(), url: r.url(), failure: r.failure()?.errorText }));
    page.on('response', (r) => r.status() >= 400 && push(this.network, { t: Date.now(), method: r.request().method(), url: r.url(), status: r.status() }));
    page.on('close', () => {
      const i = this.pages.indexOf(page);
      if (i >= 0) this.pages.splice(i, 1);
      this.current = Math.min(this.current, Math.max(this.pages.length - 1, 0));
      this.events.emit('pages');
    });
  }
}

const ordinaryChromeUa = (version) =>
  `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version.split('.')[0]}.0.0.0 Safari/537.36`;

class SessionManager {
  constructor() {
    this.sessions = new Map();
    setInterval(() => this.reap(), 15_000).unref();
  }

  list() {
    return [...this.sessions.values()].map((s) => s.info());
  }

  get(id) {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`no such session: ${id}`);
    s.touch();
    return s;
  }

  async create({ profile, ttlS, label, viewport, login = true, persist = true } = {}) {
    if (this.sessions.size >= config.maxSessions) {
      throw new Error(`session limit reached (${config.maxSessions}); close one first`);
    }
    const site = profile ? profiles.getSite(profile) : null;
    const id = crypto.randomBytes(6).toString('hex');
    const creds = site ? profiles.hasCredentials(site) : false;
    const policy = {
      navHosts: site ? profiles.allowedHosts(site) : null,
      internalAllow: [...config.internalAllow, ...(site?.allow_internal ?? [])],
    };

    const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL ?? 'chromium',
      headless: true,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--disable-dev-shm-usage',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--disable-blink-features=AutomationControlled', // navigator.webdriver === false, as in a normal browser
      ],
    });
    const identity = site?.identity ?? {};
    try {
      const context = await browser.newContext({
        storageState: profile ? profiles.loadState(profile) : undefined,
        viewport: viewport ?? { width: 1280, height: 800 },
        acceptDownloads: false,
        serviceWorkers: 'block', // service workers bypass context.route, i.e. the network guard
        permissions: [],
        // Present as an ordinary desktop Chrome rather than "HeadlessChrome" in UTC.
        userAgent: identity.user_agent ?? ordinaryChromeUa(browser.version()),
        locale: identity.locale ?? config.locale,
        timezoneId: identity.timezone ?? config.timezone,
      });
      const session = new Session(id, {
        label: label ?? profile ?? 'ephemeral',
        profileId: profile ?? null,
        persist: Boolean(profile) && persist,
        allowEvaluate: site ? (site.allow_evaluate ?? !creds) : true,
        ttlS: Math.min(ttlS ?? config.defaultTtlS, config.maxTtlS),
        browser,
        context,
        pages: [],
        current: 0,
        policy,
      });

      await context.route('**/*', async (route) => {
        const req = route.request();
        const isNav = req.isNavigationRequest() && req.frame().parentFrame() === null;
        const why = await guard.check(req.url(), { isNavigation: isNav, policy });
        if (why) {
          push(session.blocked, { t: Date.now(), url: req.url(), reason: why });
          return route.abort('blockedbyclient');
        }
        return route.continue();
      });
      await context.routeWebSocket(/.*/, async (ws) => {
        const why = await guard.check(ws.url(), { isNavigation: false, policy });
        if (why) {
          push(session.blocked, { t: Date.now(), url: ws.url(), reason: why });
          return ws.close();
        }
        ws.connectToServer();
      });
      context.on('page', (p) => session.watchPage(p));
      session.watchPage(await context.newPage());
      this.sessions.set(id, session);
      audit('session.create', { session: id, profile, ttl_s: session.ttlS });

      if (login && creds) {
        try {
          const r = await profiles.login(session);
          audit('session.login', { session: id, profile, ...r });
        } catch (e) {
          audit('session.login_failed', { session: id, profile, error: e.message });
          await this.close(id);
          throw e;
        }
      }
      return session;
    } catch (e) {
      await browser.close().catch(() => {}); // no-op if close() already ran
      throw e;
    }
  }

  async close(id) {
    const s = this.sessions.get(id);
    if (!s) return false;
    this.sessions.delete(id);
    s.events.emit('closed');
    try {
      await profiles.saveState(s);
    } catch {
      /* browser may already be gone */
    }
    await s.browser.close().catch(() => {});
    audit('session.close', { session: id });
    return true;
  }

  reap() {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (!s.busy && !s.handoff && now > s.expiresAt()) this.close(s.id).then(() => audit('session.expired', { session: s.id }));
      else if (!s.browser.isConnected()) this.close(s.id);
    }
  }

  async closeAll() {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }
}

export const manager = new SessionManager();
