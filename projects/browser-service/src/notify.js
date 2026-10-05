import { audit } from './audit.js';
import { config } from './config.js';

// Operator notifications over Discord. Delivery is tried via the channel webhook first, then a bot DM.
// The message may contain a live-view link and the webhook URL is a credential, so neither is ever logged.
// allowed_mentions is empty so agent-supplied text cannot ping @everyone or roles.

const post = (url, body, headers = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

let dmChannel = null; // cached DM channel id for the configured user

async function viaWebhook(content) {
  const r = await post(config.discordWebhook, { content, allowed_mentions: { parse: [] } });
  return { ok: r.ok, status: r.status };
}

async function viaDm(content) {
  const auth = { authorization: `Bot ${config.discordBotToken}` };
  if (!dmChannel) {
    const r = await post(`${config.discordApi}/users/@me/channels`, { recipient_id: config.discordUserId }, auth);
    if (!r.ok) return { ok: false, status: r.status };
    dmChannel = (await r.json()).id;
  }
  const r = await post(`${config.discordApi}/channels/${dmChannel}/messages`, { content, allowed_mentions: { parse: [] } }, auth);
  if (r.status === 404) dmChannel = null;
  return { ok: r.ok, status: r.status };
}

/** Send a plain-text message to the operator. Returns true if any channel delivered it. */
export async function notify(text) {
  const content = String(text).slice(0, 1900);
  const channels = [
    config.discordWebhook && ['webhook', viaWebhook],
    config.discordBotToken && config.discordUserId && ['dm', viaDm],
  ].filter(Boolean);
  if (!channels.length) {
    audit('notify.skipped', { reason: 'discord not configured' });
    return false;
  }
  for (const [name, send] of channels) {
    try {
      const r = await send(content);
      audit('notify.sent', { channel: name, ok: r.ok, status: r.status });
      if (r.ok) return true;
    } catch (e) {
      audit('notify.failed', { channel: name, error: e.message });
    }
  }
  return false;
}
