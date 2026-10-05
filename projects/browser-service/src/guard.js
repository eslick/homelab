import dns from 'node:dns/promises';
import net from 'node:net';

// Private/internal ranges a browser driven by an LLM must not reach by default: the docker
// network (yugabytedb, minio, the control API itself), loopback, link-local, tailnet (CGNAT).
const V4_PRIVATE = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const v4int = (ip) => ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const n = v4int(ip);
    return V4_PRIVATE.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (v4int(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::' || l === '::1') return true;
    if (l.startsWith('::ffff:') && net.isIPv4(l.slice(7))) return isPrivateIp(l.slice(7));
    return /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith('ff');
  }
  return true;
}

export function hostMatches(host, patterns) {
  host = host.toLowerCase();
  return patterns.some((p) => {
    p = p.toLowerCase();
    return p.startsWith('*.') ? host === p.slice(2) || host.endsWith(p.slice(1)) : host === p;
  });
}

const dnsCache = new Map(); // host -> {private, at}
async function resolvesPrivate(host) {
  const hit = dnsCache.get(host);
  if (hit && Date.now() - hit.at < 30_000) return hit.private;
  let priv;
  try {
    const addrs = await dns.lookup(host, { all: true });
    priv = addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address));
  } catch {
    priv = false; // unresolvable: the browser will fail on its own; nothing internal to protect
  }
  dnsCache.set(host, { private: priv, at: Date.now() });
  return priv;
}

/**
 * Decide whether a request may proceed. Returns null to allow, or a reason string to block.
 *  - policy.internalAllow: hostnames allowed to be private (arcana-dev, ...)
 *  - policy.navHosts: if set, top-level navigations must match (subresources are not restricted
 *    to it, since login pages load scripts from CDNs, but still may not touch private ranges)
 */
export async function check(rawUrl, { isNavigation, policy }) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return 'invalid url';
  }
  if (['data:', 'blob:', 'about:'].includes(u.protocol)) {
    return isNavigation && u.protocol !== 'about:' ? 'data/blob navigation blocked' : null;
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) return `scheme ${u.protocol} blocked`;

  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isNavigation && policy.navHosts && !hostMatches(host, policy.navHosts)) {
    return `navigation to ${host} not in profile allowed_hosts`;
  }
  if (hostMatches(host, policy.internalAllow)) return null;
  if (net.isIP(host)) return isPrivateIp(host) ? `private address ${host} blocked` : null;
  return (await resolvesPrivate(host)) ? `${host} resolves to a private address` : null;
}
