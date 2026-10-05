import fs from 'node:fs';

const env = process.env;
const list = (v, d) => (v ?? d).split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  port: Number(env.PORT ?? 8931),
  dataDir: env.DATA_DIR ?? '/data',
  apiToken: env.BROWSER_SERVICE_TOKEN ?? '',
  sitesFile: env.SITES_FILE ?? '/run/secrets/browser-sites.json',
  maxSessions: Number(env.MAX_SESSIONS ?? 4),
  defaultTtlS: Number(env.DEFAULT_TTL_S ?? 1800),
  maxTtlS: Number(env.MAX_TTL_S ?? 14400),
  // Hostnames that may resolve to private addresses (the things we are asked to debug).
  internalAllow: list(env.ALLOW_INTERNAL_HOSTS, 'arcana-dev,arcana-dev-2'),
  // Cap on text returned by tools so a huge page cannot flood a model's context.
  // Browser identity: look like the operator's ordinary Chrome (no HeadlessChrome UA, no webdriver flag,
  // local timezone/locale). Per-profile `identity` overrides these.
  locale: env.BROWSER_LOCALE ?? 'en-US',
  timezone: env.BROWSER_TIMEZONE ?? 'America/Los_Angeles',
  // Human handoff: operator is notified on Telegram with a link to a live view of the session.
  publicUrl: (env.PUBLIC_URL ?? '').replace(/\/$/, ''),
  frameAncestors: list(env.FRAME_ANCESTORS, ''),
  handoffTtlS: Number(env.HANDOFF_TTL_S ?? 1800),
  telegramToken: env.TELEGRAM_BOT_TOKEN ?? '',
  telegramChatId: env.TELEGRAM_CHAT_ID ?? '',
  telegramApi: env.TELEGRAM_API_BASE ?? 'https://api.telegram.org',
  maxTextChars: Number(env.MAX_TEXT_CHARS ?? 40000),
};

if (!config.apiToken) {
  console.error('BROWSER_SERVICE_TOKEN is required');
  process.exit(1);
}

/** Site/profile definitions are re-read on every use so a redeploy of the file needs no restart. */
export function loadSites() {
  try {
    return JSON.parse(fs.readFileSync(config.sitesFile, 'utf8')).sites ?? {};
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`cannot parse ${config.sitesFile}: ${e.message}`);
  }
}
