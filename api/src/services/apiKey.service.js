const crypto = require('crypto');
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');

const KEY_PREFIX = 'pk_live_';

// SHA-256, not bcrypt — this is a high-entropy random token (32 bytes,
// effectively unguessable), not a human-memorable password, so there's
// nothing for bcrypt's deliberate slowness to defend against here. A fast
// hash also matters more for this one: requireApiKey.js runs it on every
// external-API request, not once at login.
function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

function toShaped(key) {
  return {
    id: key.id,
    nama: key.nama,
    keySuffix: key.keySuffix,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
  };
}

async function list() {
  const keys = await prisma.apiKey.findMany({ orderBy: { id: 'desc' } });
  return keys.map(toShaped);
}

// Returns the raw key exactly once — the only time it's ever visible
// anywhere, including to this codebase itself (only the hash is kept).
async function create(nama) {
  const rawKey = `${KEY_PREFIX}${crypto.randomBytes(32).toString('hex')}`;
  const key = await prisma.apiKey.create({
    data: {
      nama,
      keyHash: hashKey(rawKey),
      keySuffix: rawKey.slice(-6),
    },
  });
  return { ...toShaped(key), rawKey };
}

async function revoke(id) {
  const existing = await prisma.apiKey.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'API key tidak ditemukan');
  }
  if (existing.revokedAt) return toShaped(existing);
  const updated = await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  return toShaped(updated);
}

// Called from requireApiKey.js on every external-API request. Updates
// lastUsedAt best-effort (fire-and-forget — a write failure here must
// never block or fail the actual request it's just bookkeeping for).
async function verify(rawKey) {
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) return null;
  const key = await prisma.apiKey.findUnique({ where: { keyHash: hashKey(rawKey) } });
  if (!key || key.revokedAt) return null;
  prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return key;
}

module.exports = { list, create, revoke, verify };
