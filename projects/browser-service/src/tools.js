import { z } from 'zod';
import { audit } from './audit.js';
import { config } from './config.js';
import * as profiles from './profiles.js';
import { manager } from './sessions.js';

// One tool registry, two transports: REST (POST /v1/sessions/:id/tools/:name) for Arcana and MCP
// (/mcp) for Claude. A handler returns MCP-style content parts: {type:'text'} | {type:'image'}.

const text = (t) => [{ type: 'text', text: String(t) }];
const clip = (s) => (s.length > config.maxTextChars ? s.slice(0, config.maxTextChars) + `\n…[truncated ${s.length - config.maxTextChars} chars]` : s);
const json = (v) => text(clip(JSON.stringify(v, null, 2)));

const target = {
  ref: z.string().optional().describe('Element ref from a snapshot, e.g. "e12" or "f4e2" (the text inside [ref=...])'),
  selector: z.string().optional().describe('Playwright selector (CSS, text=, role=); use when no ref'),
};
const loc = (page, { ref, selector }) => {
  if (ref) return page.locator(`aria-ref=${ref}`);
  if (selector) return page.locator(selector).first();
  throw new Error('ref or selector is required');
};
const status = async (page) => `url: ${page.url()}\ntitle: ${await page.title().catch(() => '')}`;
const TIMEOUT = 15000;

export const tools = [
  {
    name: 'navigate',
    description: 'Open a URL in the current tab. Subject to the session network policy (private addresses and off-profile hosts are blocked).',
    schema: { url: z.string().url(), wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).default('load') },
    run: async (s, { url, wait_until }) => {
      const r = await s.page.goto(url, { waitUntil: wait_until, timeout: 30000 });
      return text(`${await status(s.page)}\nhttp: ${r?.status() ?? 'n/a'}`);
    },
  },
  {
    name: 'snapshot',
    description: 'Accessibility-tree snapshot of the page (or a sub-tree) with element refs ([ref=...]) usable by click/fill/etc. Prefer this over screenshots for deciding what to do.',
    schema: { selector: z.string().optional(), depth: z.number().int().positive().optional() },
    run: async (s, { selector, depth }) => {
      const l = selector ? s.page.locator(selector).first() : s.page.locator('body');
      return text(`${await status(s.page)}\n\n${clip(await l.ariaSnapshot({ mode: 'ai', depth }))}`);
    },
  },
  {
    name: 'click',
    description: 'Click an element.',
    schema: { ...target, double: z.boolean().default(false), button: z.enum(['left', 'right', 'middle']).default('left') },
    run: async (s, a) => {
      const l = loc(s.page, a);
      await (a.double ? l.dblclick({ timeout: TIMEOUT, button: a.button }) : l.click({ timeout: TIMEOUT, button: a.button }));
      return text(await status(s.page));
    },
  },
  {
    name: 'fill',
    description: 'Replace the value of an input/textarea. Never use this for stored site credentials; use `login`.',
    schema: { ...target, value: z.string(), submit: z.boolean().default(false).describe('Press Enter afterwards') },
    run: async (s, a) => {
      const l = loc(s.page, a);
      await l.fill(a.value, { timeout: TIMEOUT });
      if (a.submit) await l.press('Enter');
      return text(await status(s.page));
    },
  },
  {
    name: 'press',
    description: 'Press a key or chord on the page, e.g. "Enter", "Control+A".',
    schema: { key: z.string() },
    run: async (s, { key }) => {
      await s.page.keyboard.press(key);
      return text(await status(s.page));
    },
  },
  {
    name: 'hover',
    description: 'Hover over an element.',
    schema: target,
    run: async (s, a) => {
      await loc(s.page, a).hover({ timeout: TIMEOUT });
      return text('ok');
    },
  },
  {
    name: 'select_option',
    description: 'Choose option(s) in a <select> by value or label.',
    schema: { ...target, values: z.array(z.string()).min(1) },
    run: async (s, a) => json(await loc(s.page, a).selectOption(a.values, { timeout: TIMEOUT })),
  },
  {
    name: 'wait_for',
    description: 'Wait for text to appear/disappear, a selector to be visible, or a fixed delay. Use selector ".phx-connected" to wait for a Phoenix LiveView to mount.',
    schema: {
      text: z.string().optional(),
      text_gone: z.string().optional(),
      selector: z.string().optional(),
      time_ms: z.number().int().min(0).max(30000).optional(),
      timeout_ms: z.number().int().positive().max(60000).default(15000),
    },
    run: async (s, a) => {
      if (a.time_ms) await s.page.waitForTimeout(a.time_ms);
      if (a.text) await s.page.getByText(a.text).first().waitFor({ state: 'visible', timeout: a.timeout_ms });
      if (a.text_gone) await s.page.getByText(a.text_gone).first().waitFor({ state: 'hidden', timeout: a.timeout_ms });
      if (a.selector) await s.page.locator(a.selector).first().waitFor({ state: 'visible', timeout: a.timeout_ms });
      return text(await status(s.page));
    },
  },
  {
    name: 'screenshot',
    description: 'PNG screenshot of the viewport, full page, or one element.',
    schema: { ...target, full_page: z.boolean().default(false) },
    run: async (s, a) => {
      const buf = a.ref || a.selector ? await loc(s.page, a).screenshot({ timeout: TIMEOUT }) : await s.page.screenshot({ fullPage: a.full_page });
      return [{ type: 'image', data: buf.toString('base64'), mimeType: 'image/png' }];
    },
  },
  {
    name: 'get_text',
    description: 'Visible text of the page or an element (innerText).',
    schema: { selector: z.string().optional() },
    run: async (s, { selector }) => text(clip(await (selector ? s.page.locator(selector).first() : s.page.locator('body')).innerText({ timeout: TIMEOUT }))),
  },
  {
    name: 'get_html',
    description: 'Outer HTML of an element, or the whole document.',
    schema: { selector: z.string().optional() },
    run: async (s, { selector }) =>
      text(clip(selector ? await s.page.locator(selector).first().evaluate((e) => e.outerHTML) : await s.page.content())),
  },
  {
    name: 'evaluate',
    description: 'Run a JavaScript expression in the page and return its JSON value, e.g. "window.liveSocket.isConnected()". Disabled for sessions whose profile holds credentials unless the profile sets allow_evaluate.',
    schema: { expression: z.string() },
    run: async (s, { expression }) => {
      if (!s.allowEvaluate) throw new Error('evaluate is disabled for this profile');
      return json(await s.page.evaluate(expression));
    },
  },
  {
    name: 'console_messages',
    description: 'Browser console output and uncaught page errors since the session started (newest last). Core tool for debugging a web UI.',
    schema: { level: z.enum(['all', 'error', 'warning']).default('all'), clear: z.boolean().default(false) },
    run: async (s, { level, clear }) => {
      const rank = { error: ['error', 'pageerror'], warning: ['error', 'pageerror', 'warning'] };
      const out = s.console.filter((m) => level === 'all' || rank[level].includes(m.type));
      if (clear) s.console.length = 0;
      return json(out);
    },
  },
  {
    name: 'network_log',
    description: 'Failed requests and HTTP >= 400 responses, plus requests blocked by the network policy.',
    schema: { clear: z.boolean().default(false) },
    run: async (s, { clear }) => {
      const out = { failed_or_error: [...s.network], blocked_by_policy: [...s.blocked] };
      if (clear) s.network.length = s.blocked.length = 0;
      return json(out);
    },
  },
  {
    name: 'tabs',
    description: 'List, open, select or close tabs.',
    schema: { action: z.enum(['list', 'new', 'select', 'close']).default('list'), index: z.number().int().min(0).optional(), url: z.string().url().optional() },
    run: async (s, { action, index, url }) => {
      if (action === 'new') {
        const p = await s.context.newPage();
        if (url) await p.goto(url);
      } else if (action === 'select') {
        if (!s.pages[index]) throw new Error('no such tab');
        s.current = index;
      } else if (action === 'close') {
        await (s.pages[index ?? s.current]?.close() ?? Promise.reject(new Error('no such tab')));
      }
      return json(await Promise.all(s.pages.map(async (p, i) => ({ index: i, current: p === s.page, url: p.url(), title: await p.title().catch(() => '') }))));
    },
  },
  {
    name: 'login',
    description: "Log this session's profile in using credentials stored in the service (you never see them). Idempotent: a saved login is reused. Sessions created with a credentialed profile log in automatically.",
    schema: { force: z.boolean().default(false).describe('Re-run the login even if the saved session still works') },
    run: async (s, { force }) => {
      if (!s.profileId) throw new Error('this session has no profile');
      return json(await profiles.login(s, { force }));
    },
  },
  {
    name: 'session_info',
    description: 'Describe the current browser session (profile, expiry, tabs).',
    schema: {},
    run: async (s) => json(s.info()),
  },
  {
    name: 'close_session',
    description: 'Close this browser session and save its profile state. Call when done.',
    schema: {},
    run: async (s) => {
      await manager.close(s.id);
      return text('closed');
    },
  },
];

export const toolByName = new Map(tools.map((t) => [t.name, t]));
export const argsSchema = (t) => z.object(t.schema).strict();

/** Validate, audit and execute one tool against a session. Throws on bad input or tool failure. */
export async function runTool(session, name, rawArgs) {
  const tool = toolByName.get(name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  const args = argsSchema(tool).parse(rawArgs ?? {});
  audit('tool', { session: session.id, tool: name, args });
  session.busy = true;
  session.touch();
  try {
    return await tool.run(session, args);
  } finally {
    session.busy = false;
    session.touch();
  }
}
