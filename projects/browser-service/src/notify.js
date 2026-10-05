import { audit } from './audit.js';
import { config } from './config.js';

/** Send a plain-text Telegram message to the operator. Returns true if delivered. Never logs the text (it may hold a live-view link). */
export async function notify(text) {
  if (!config.telegramToken || !config.telegramChatId) {
    audit('notify.skipped', { reason: 'telegram not configured' });
    return false;
  }
  try {
    const r = await fetch(`${config.telegramApi}/bot${config.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegramChatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    });
    audit('notify.sent', { ok: r.ok, status: r.status });
    return r.ok;
  } catch (e) {
    audit('notify.failed', { error: e.message });
    return false;
  }
}
