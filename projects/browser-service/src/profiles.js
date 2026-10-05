import fs from 'node:fs';
import path from 'node:path';
import * as OTPAuth from 'otpauth';
import { config, loadSites } from './config.js';
import { hostMatches } from './guard.js';

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;

export function validId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

export function getSite(id) {
  if (!validId(id)) throw new Error(`invalid profile id: ${id}`);
  const site = loadSites()[id];
  if (!site) throw new Error(`unknown profile: ${id}`);
  return site;
}

export const hasCredentials = (site) => Boolean(site.username && site.password) || Boolean(site.steps);

export function allowedHosts(site) {
  if (site.allowed_hosts?.length) return site.allowed_hosts;
  if (site.login_url) return [new URL(site.login_url).hostname];
  return null;
}

/** Public view of a profile: never includes secrets. */
export function describe(id, site) {
  return {
    id,
    label: site.label ?? id,
    has_credentials: hasCredentials(site),
    has_totp: Boolean(site.totp_secret),
    has_saved_state: fs.existsSync(statePath(id)),
    allowed_hosts: allowedHosts(site),
    allow_evaluate: site.allow_evaluate ?? !hasCredentials(site),
  };
}

export function listProfiles() {
  return Object.entries(loadSites()).map(([id, s]) => describe(id, s));
}

// ---- persisted browser state (cookies + localStorage), one file per profile ----

const profileDir = (id) => path.join(config.dataDir, 'profiles', id);
export const statePath = (id) => path.join(profileDir(id), 'state.json');

export function loadState(id) {
  try {
    return JSON.parse(fs.readFileSync(statePath(id), 'utf8'));
  } catch {
    return undefined;
  }
}

export function writeState(id, state) {
  fs.mkdirSync(profileDir(id), { recursive: true, mode: 0o700 });
  const tmp = statePath(id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmp, statePath(id));
}

export function importState(id, state) {
  getSite(id);
  if (!state || !Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
    throw new Error('state must be a Playwright storageState: {cookies: [], origins: []}');
  }
  writeState(id, state);
}

export function forgetState(id) {
  fs.rmSync(statePath(id), { force: true });
}

// ---- login ----

const DEFAULTS = {
  username: 'input[autocomplete="username"], input[type="email"], input[name*="user" i], input[name*="login" i], input[name*="email" i], input[id*="user" i], input[id*="email" i]',
  password: 'input[type="password"]',
  submit: 'button[type="submit"], input[type="submit"]',
  totp: 'input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="totp" i], input[name*="code" i]',
};

const settle = async (page) => {
  await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
};
const visible = (loc, timeout) => loc.waitFor({ state: 'visible', timeout }).then(() => true, () => false);

function totpNow(site) {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(site.totp_secret.replace(/\s+/g, '')) }).generate();
}

async function submit(page, sel) {
  const btn = page.locator(sel.submit).first();
  if (await visible(btn, 1500)) await btn.click();
  else await page.keyboard.press('Enter');
  await settle(page);
}

async function defaultFlow(page, site) {
  const sel = { ...DEFAULTS, ...(site.form ?? {}) };
  const user = page.locator(sel.username).first();
  if (!(await visible(user, 15000))) throw new Error('username field not found (set form.username for this profile)');
  await user.fill(site.username);
  const pass = page.locator(sel.password).first();
  if (!(await visible(pass, 1000))) {
    await submit(page, sel); // two-step login: username first
    if (!(await visible(pass, 15000))) throw new Error('password field not found (set form.password)');
  }
  await pass.fill(site.password);
  await submit(page, sel);
  if (site.totp_secret) {
    const otp = page.locator(sel.totp).first();
    if (await visible(otp, 5000)) {
      await otp.fill(totpNow(site));
      await submit(page, sel);
    }
  }
}

/** Small step DSL for sites the default flow cannot handle. Values may use {{username}} {{password}} {{totp}}. */
async function runSteps(page, site) {
  const sub = (v) =>
    String(v).replace(/\{\{(username|password|totp)\}\}/g, (_, k) => (k === 'totp' ? totpNow(site) : site[k]));
  for (const s of site.steps) {
    if (s.goto) await page.goto(sub(s.goto));
    else if (s.fill) await page.locator(s.fill).first().fill(sub(s.value ?? ''));
    else if (s.click) await page.locator(s.click).first().click();
    else if (s.press) await page.keyboard.press(s.press);
    else if (s.wait_for) await page.locator(s.wait_for).first().waitFor({ state: 'visible', timeout: s.timeout ?? 15000 });
    else throw new Error(`unknown login step: ${JSON.stringify(Object.keys(s))}`);
    await settle(page);
  }
}

/** True when the saved/created session is authenticated, per the profile's `verify` block. */
export async function isLoggedIn(page, site) {
  const v = site.verify;
  if (!v?.url || !(v.present || v.absent)) throw new Error('profile needs verify: {url, present|absent}');
  await page.goto(v.url, { waitUntil: 'domcontentloaded' });
  await settle(page);
  if (v.present) return visible(page.locator(v.present).first(), 8000);
  return !(await visible(page.locator(v.absent).first(), 3000));
}

export async function login(session, { force = false } = {}) {
  const { page, profileId: id } = session;
  const site = getSite(id);
  if (!hasCredentials(site)) {
    // Human-managed profile (e.g. Google SSO): only verify the saved login.
    if (site.verify && (await isLoggedIn(page, site))) return { status: 'already_logged_in' };
    throw new Error(`profile ${id} is not logged in and has no stored credentials; call request_human so the operator can sign in`);
  }
  if (!force && (await isLoggedIn(page, site))) return { status: 'already_logged_in' };

  const hosts = allowedHosts(site);
  await page.goto(site.login_url ?? site.verify.url, { waitUntil: 'domcontentloaded' });
  await settle(page);
  // Never type credentials into an origin that is not this profile's own.
  const host = new URL(page.url()).hostname;
  if (hosts && !hostMatches(host, hosts)) throw new Error(`refusing to fill credentials on ${host}`);

  try {
    if (site.steps) await runSteps(page, site);
    else await defaultFlow(page, site);
    if (!(await isLoggedIn(page, site))) throw new Error('login did not reach the logged-in state (check verify, 2FA/captcha)');
  } catch (e) {
    const shot = path.join(config.dataDir, 'artifacts', `login-failure-${id}.png`);
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    await page.screenshot({ path: shot }).catch(() => {});
    throw new Error(`${e.message} (screenshot: ${shot} in the data volume)`);
  }
  await saveState(session);
  return { status: 'logged_in' };
}

export async function saveState(session) {
  if (session.profileId && session.persist) writeState(session.profileId, await session.context.storageState());
}
