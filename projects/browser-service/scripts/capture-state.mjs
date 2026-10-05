#!/usr/bin/env node
// Capture a logged-in browser state on YOUR machine (headed, so you can do 2FA/captcha by hand)
// and upload it to a browser-service profile. Use this for sites the automatic login cannot handle.
//
//   npm i playwright-core && npx playwright-core install chromium   # once, on your laptop
//   BROWSER_SERVICE_TOKEN=... node capture-state.mjs <profile> <login-url> \
//       [--service https://speedracer.terrier-haddock.ts.net:8931]
//
// The profile must already exist in browser_sites (playbooks/browser-service.yml).
import readline from 'node:readline/promises';
import { chromium } from 'playwright-core';

const [profile, loginUrl] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n, d) => process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d;
const service = flag('service', 'https://speedracer.terrier-haddock.ts.net:8931');
const token = process.env.BROWSER_SERVICE_TOKEN;
if (!profile || !loginUrl || !token) {
  console.error('usage: BROWSER_SERVICE_TOKEN=... capture-state.mjs <profile> <login-url> [--service URL]');
  process.exit(2);
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
await (await context.newPage()).goto(loginUrl);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question('Log in in the browser window, then press Enter here to upload the session... ');
rl.close();

const state = await context.storageState();
await browser.close();
const r = await fetch(`${service}/v1/profiles/${profile}/state`, {
  method: 'PUT',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(state),
});
console.log(r.ok ? `uploaded state for "${profile}" (${state.cookies.length} cookies)` : `upload failed: ${r.status} ${await r.text()}`);
process.exit(r.ok ? 0 : 1);
