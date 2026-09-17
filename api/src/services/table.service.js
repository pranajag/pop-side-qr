const crypto = require('crypto');
const QRCode = require('qrcode');
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { isForeignKeyError, isUniqueConstraintError } = require('../utils/prismaErrors');

// Sprint 3 serves GET /t/:token on public-web to resolve a scanned table —
// this is the contract that route must honor once it exists.
const PUBLIC_WEB_URL = process.env.PUBLIC_WEB_URL || 'http://localhost:5174';

function computeQrToken(id, tokenSecret) {
  return crypto.createHmac('sha256', tokenSecret).update(`table:${id}`).digest('hex');
}

function tableUrl(qrToken) {
  return `${PUBLIC_WEB_URL}/t/${qrToken}`;
}

function withUrl(table) {
  return { ...table, url: tableUrl(table.qrToken) };
}

async function assertNomorMejaFree(nomorMeja, excludeId) {
  // nomor_meja has no DB-level unique constraint yet (Sprint 1's schema
  // didn't add one) — checked here so two tables can't collide in the
  // meantime. Safe to remove once a migration adds @@unique([nomorMeja]).
  const dup = await prisma.table.findFirst({ where: { nomorMeja } });
  if (dup && dup.id !== excludeId) {
    throw new AppError(409, 'Nomor meja sudah dipakai');
  }
}

async function list() {
  const tables = await prisma.table.findMany({ orderBy: { id: 'asc' } });
  return tables.map(withUrl);
}

async function create(data) {
  await assertNomorMejaFree(data.nomorMeja);

  const tokenSecret = crypto.randomBytes(32).toString('hex');

  try {
    const table = await prisma.$transaction(async (tx) => {
      // qrToken is a required unique column derived from the row's own id
      // (the HMAC subject), which doesn't exist before insert — so the row
      // is created with a random placeholder, then immediately corrected
      // to the real HMAC in the same transaction.
      const created = await tx.table.create({
        data: { ...data, tokenSecret, qrToken: crypto.randomUUID() },
      });
      return tx.table.update({
        where: { id: created.id },
        data: { qrToken: computeQrToken(created.id, tokenSecret) },
      });
    });
    return withUrl(table);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new AppError(409, 'Nomor meja sudah dipakai');
    }
    throw err;
  }
}

async function update(id, data) {
  const existing = await prisma.table.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Meja tidak ditemukan');
  }
  if (data.nomorMeja !== undefined) {
    await assertNomorMejaFree(data.nomorMeja, id);
  }

  try {
    const table = await prisma.table.update({ where: { id }, data });
    return withUrl(table);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new AppError(409, 'Nomor meja sudah dipakai');
    }
    throw err;
  }
}

async function remove(id) {
  const existing = await prisma.table.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Meja tidak ditemukan');
  }
  try {
    await prisma.table.delete({ where: { id } });
  } catch (err) {
    if (isForeignKeyError(err)) {
      throw new AppError(409, 'Meja tidak bisa dihapus karena sudah memiliki riwayat order. Nonaktifkan lewat isActive saja.');
    }
    throw err;
  }
}

async function resetToken(id) {
  const existing = await prisma.table.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Meja tidak ditemukan');
  }

  // Each table has its own independent tokenSecret, so regenerating it
  // here only ever touches this one row — other tables' QR codes are
  // untouched (AGENTS.md rule #9).
  const tokenSecret = crypto.randomBytes(32).toString('hex');
  const table = await prisma.table.update({
    where: { id },
    data: { tokenSecret, qrToken: computeQrToken(id, tokenSecret) },
  });
  return withUrl(table);
}

async function generateQrImage(id) {
  const table = await prisma.table.findUnique({ where: { id } });
  if (!table) {
    throw new AppError(404, 'Meja tidak ditemukan');
  }
  return QRCode.toBuffer(tableUrl(table.qrToken), { type: 'png', margin: 2, width: 400 });
}

function timingSafeHexEqual(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

// Public — called when a customer scans a table's QR. The unique index on
// qrToken is the real gate (an attacker without the right token can't even
// reach a row); the HMAC recompute below is defense-in-depth against the
// token column being tampered with directly (bypassing resetToken()).
async function verifyToken(token) {
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return null;
  }

  const table = await prisma.table.findUnique({ where: { qrToken: token } });
  if (!table || !table.isActive) {
    return null;
  }

  const expected = computeQrToken(table.id, table.tokenSecret);
  if (!timingSafeHexEqual(expected, token)) {
    return null;
  }

  return { id: table.id, nomorMeja: table.nomorMeja };
}

module.exports = { list, create, update, remove, resetToken, generateQrImage, verifyToken };
