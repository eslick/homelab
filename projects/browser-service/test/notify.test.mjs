// Unit test for the Discord DM path (the smoke suite covers the webhook path). Run: node --test test/
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

const calls = [];
const srv = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => (b += d)).on('end', () => {
    calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b) });
    res.setHeader('content-type', 'application/json');
    res.end(req.url.endsWith('/users/@me/channels') ? '{"id":"chan1"}' : '{"id":"msg1"}');
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));

Object.assign(process.env, {
  BROWSER_SERVICE_TOKEN: 't', DATA_DIR: '/tmp', DISCORD_BOT_TOKEN: 'bot-secret', DISCORD_USER_ID: '42',
  DISCORD_API_BASE: `http://127.0.0.1:${srv.address().port}`,
});
const { notify } = await import('../src/notify.js');

test('DM path opens a channel once, posts with bot auth, and blocks mentions', async () => {
  assert.equal(await notify('hello @everyone'), true);
  assert.equal(await notify('again'), true);
  assert.equal(calls.filter((c) => c.url.endsWith('/users/@me/channels')).length, 1, 'DM channel is cached');
  const msg = calls.find((c) => c.url === '/channels/chan1/messages');
  assert.equal(msg.auth, 'Bot bot-secret');
  assert.deepEqual(msg.body.allowed_mentions, { parse: [] });
  assert.equal(calls[0].body.recipient_id, '42');
  srv.close();
});
