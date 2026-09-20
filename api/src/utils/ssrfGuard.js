const dns = require('dns').promises;
const net = require('net');

// Private/reserved ranges a server-initiated fetch must never be allowed to
// reach. webhook.service.js's dispatch() runs fetch() FROM this server, not
// from a browser — so it can reach internal-only infrastructure (cloud
// metadata at 169.254.169.254, an internal admin panel, this API's own
// loopback) that's never reachable from outside. Creating a webhook is
// admin-only and webhook.validator.js already requires https://, but
// neither stops an attacker who already has an admin session (exactly the
// "sudah kena serangan" scenario this hardening pass assumes) from pointing
// a public hostname's DNS at a private IP.
const V4_BLOCKED = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local — includes cloud metadata (169.254.169.254)
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
];

function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isBlockedV4(ip) {
  const target = ipToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (target & mask) === (ipToInt(base) & mask);
  });
}

function isBlockedV6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.split(':').pop();
    return net.isIPv4(v4) ? isBlockedV4(v4) : true;
  }
  if (normalized.startsWith('fe80:')) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true; // unique local, fc00::/7
  return false;
}

function isBlockedIp(ip) {
  return net.isIPv4(ip) ? isBlockedV4(ip) : isBlockedV6(ip);
}

// Re-resolved on every call (not cached) — deliberately, so a webhook that
// resolved to a public IP when it was created but has since been repointed
// at a private one (DNS rebinding, or just an admin's domain changing
// months later) gets caught at the moment it actually matters: dispatch
// time, not just registration time.
async function isUrlSafe(urlString) {
  let hostname;
  try {
    hostname = new URL(urlString).hostname;
  } catch {
    return false;
  }

  if (net.isIP(hostname)) {
    return !isBlockedIp(hostname);
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return false; // unresolvable — fail closed
  }
  // Every resolved address must be safe, not just the first — a hostname
  // that round-robins between one public and one private address should
  // still be rejected.
  return records.length > 0 && records.every((r) => !isBlockedIp(r.address));
}

module.exports = { isUrlSafe };
