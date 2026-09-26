const dns = require('dns').promises;
const http = require('http');
const https = require('https');
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

// Alamat IPv6 -> 8 blok 16-bit, atau null kalau bukan IPv6 yang sah.
// Dicek per blok, bukan per teks: satu alamat punya banyak cara tulis
// ("::1" = "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1" = "::ffff:7f00:1"), dan
// pencocokan teks hanya menangkap sebagian bentuknya.
function parseIPv6(ip) {
  let s = ip.toLowerCase().split('%')[0]; // buang zone id (fe80::1%eth0)
  const dotted = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    if (!net.isIPv4(dotted[2])) return null;
    const n = ipToInt(dotted[2]);
    s = `${dotted[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const kosong = 8 - head.length - tail.length;
  if (halves.length === 1 ? kosong !== 0 : kosong < 1) return null;
  const blocks = [...head, ...Array(halves.length === 2 ? kosong : 0).fill('0'), ...tail];
  if (blocks.some((b) => !/^[0-9a-f]{1,4}$/.test(b))) return null;
  return blocks.map((b) => parseInt(b, 16));
}

// IPv4 yang terselip di dua blok IPv6 berurutan (mulai dari blok ke-i).
function v4Dari(h, i) {
  return [h[i] >> 8, h[i] & 0xff, h[i + 1] >> 8, h[i + 1] & 0xff].join('.');
}

function isBlockedV6(ip) {
  const h = parseIPv6(ip);
  if (!h) return true; // tidak bisa dibaca — tolak
  const nol = (dari, sampai) => h.slice(dari, sampai).every((b) => b === 0);
  if (nol(0, 7) && h[7] <= 1) return true; // :: dan ::1 (loopback)
  // Bentuk yang membawa IPv4 di dalamnya — IPv4 itulah yang menentukan:
  // ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible, usang),
  // ::ffff:0:a.b.c.d (translated), 64:ff9b::a.b.c.d (NAT64), 2002:: (6to4).
  if (nol(0, 5) && (h[5] === 0xffff || h[5] === 0)) return isBlockedV4(v4Dari(h, 6));
  if (nol(0, 4) && h[4] === 0xffff && h[5] === 0) return isBlockedV4(v4Dari(h, 6));
  if (h[0] === 0x64 && h[1] === 0xff9b && nol(2, 6)) return isBlockedV4(v4Dari(h, 6));
  if (h[0] === 0x2002) return isBlockedV4(v4Dari(h, 1));
  if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 1) return true; // NAT64 lokal (64:ff9b:1::/48)
  if (h[0] === 0x2001 && h[1] === 0) return true; // Teredo — ujung terowongan tidak bisa dicek
  if (h[0] === 0x2001 && h[1] === 0xdb8) return true; // dokumentasi
  if (h[0] === 0x100 && nol(1, 4)) return true; // discard-only (100::/64)
  if ((h[0] & 0xfe00) === 0xfc00) return true; // unique local, fc00::/7
  if ((h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xffc0) === 0xfec0) return true; // link-local fe80::/10, site-local fec0::/10
  if ((h[0] & 0xff00) === 0xff00) return true; // multicast, ff00::/8
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

// isUrlSafe() di atas memeriksa hasil resolve DNS, tapi fetch() lalu
// me-resolve LAGI saat benar-benar konek — di antara keduanya, domain milik
// penyerang bisa menjawab IP publik untuk pertanyaan pertama dan IP
// internal untuk yang kedua (DNS rebinding). lookupAman dipasang sebagai
// opsi `lookup` koneksi, jadi alamat yang dicek adalah alamat yang
// benar-benar dipakai untuk konek, pada detik koneksi dibuat.
function lookupAman(hostname, options, callback) {
  dns.lookup(hostname, { family: options?.family, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some((a) => isBlockedIp(a.address))) {
      const blocked = new Error('Alamat tujuan diblokir: mengarah ke jaringan internal');
      blocked.code = 'SSRF_BLOCKED';
      return callback(blocked);
    }
    if (options?.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

const BATAS_WAKTU_MS = 3000;

// POST ke URL luar (webhook) dengan penjagaan SSRF penuh: hanya http/https,
// IP literal internal ditolak sebelum konek, hostname divalidasi di tingkat
// koneksi (lookupAman), redirect TIDAK diikuti, batas waktu 3 detik dari
// awal sampai akhir, dan isi balasan tidak pernah dibaca — endpoint yang
// membalas raksasa tidak bisa membebani server.
function kirimAman(urlString, { method = 'POST', headers = {}, body, timeoutMs = BATAS_WAKTU_MS } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      return reject(new Error('URL tidak valid'));
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return reject(new Error('Protokol tidak diizinkan'));
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isBlockedIp(host)) {
      const blocked = new Error('Alamat tujuan diblokir: mengarah ke jaringan internal');
      blocked.code = 'SSRF_BLOCKED';
      return reject(blocked);
    }

    const modul = url.protocol === 'https:' ? https : http;
    const req = modul.request(url, { method, headers, lookup: lookupAman }, (res) => {
      clearTimeout(timer);
      res.destroy();
      resolve({ status: res.statusCode, redirect: res.statusCode >= 300 && res.statusCode < 400 });
    });
    const timer = setTimeout(() => req.destroy(new Error(`Tidak ada balasan dalam ${timeoutMs} ms`)), timeoutMs);
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    if (body) req.write(body);
    req.end();
  });
}

module.exports = { isUrlSafe, isBlockedIp, kirimAman };
