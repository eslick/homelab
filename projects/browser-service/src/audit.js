import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const file = path.join(config.dataDir, 'audit.jsonl');
const SECRET_KEYS = /pass|secret|token|totp/i;

function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : redact(x)]));
  }
  return typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v;
}

/** Append-only action log: who did what in which session. Never records credentials. */
export function audit(event, fields = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), event, ...redact(fields) });
  try {
    fs.appendFileSync(file, line + '\n');
  } catch {
    /* logging must never break a request */
  }
  console.log(line);
}
