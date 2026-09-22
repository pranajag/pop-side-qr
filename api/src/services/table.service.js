const crypto = require('crypto');
const QRCode = require('qrcode');
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { isForeignKeyError, isUniqueConstraintError } = require('../utils/prismaErrors');
const { NON_TERMINAL_STATUSES } = require('../utils/orderStatus');

// Sprint 3 serves GET /t/:token on public-web to resolve a scanned table —
// this is the contract that route must honor once it exists.
const PUBLIC_WEB_URL = process.env.PUBLIC_WEB_URL || 'http://localhost:5174';

function computeQrToken(id, tokenSecret) {
  return crypto.createHmac('sha256', tokenSecret).update(`table:${id}`).digest('hex');
}

function tableUrl(qrToken) {
  return `${PUBLIC_WEB_URL}/t/${qrToken}`;
}

// Explicit allowlist, not a spread — table rows carry tokenSecret, the
// per-table HMAC key, which must never leave the server (AGENTS.md rule
// #9's whole point). qrToken itself is fine to return: it's the value
// printed on the table's QR code, already public by design.
function withUrl(table) {
  return {
    id: table.id,
    nomorMeja: table.nomorMeja,
    qrToken: table.qrToken,
    isActive: table.isActive,
    kapasitas: table.kapasitas,
    isBillOpen: table.isBillOpen,
    url: tableUrl(table.qrToken),
  };
}

async function assertNomorMejaFree(nomorMeja, excludeId) {
  // nomor_meja is also @unique at the DB level (Sprint 4 migration) — that
  // catch is the real race-condition guard (see isUniqueConstraintError
  // below). This pre-check just avoids the round-trip for the common case
  // and gives a cleaner message than a raw constraint violation.
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
  // Shrinking kapasitas below a guest count this table is already booked
  // for (reservation.service.js's assertTableFits checked it fit at
  // booking time) would otherwise silently leave that reservation pointed
  // at a table too small for it, discovered only on the day.
  if (data.kapasitas !== undefined && data.kapasitas < existing.kapasitas) {
    const tooBig = await prisma.reservation.findFirst({
      where: { tableId: id, status: { in: ['pending', 'confirmed'] }, jumlahTamu: { gt: data.kapasitas } },
    });
    if (tooBig) {
      throw new AppError(
        409,
        `Meja ini masih punya reservasi untuk ${tooBig.jumlahTamu} orang (${tooBig.namaCustomer}) — tidak bisa diubah ke kapasitas ${data.kapasitas}.`
      );
    }
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
      // orders/reservations/staff_calls all RESTRICT delete on this table,
      // and a bare P2002 error can't say which one actually fired — a table
      // with e.g. only one old cancelled reservation (zero orders) would
      // otherwise get told "riwayat order" and staff would go looking for
      // orders that don't exist. Check all three so the message matches
      // the real blocker.
      const [hasOrder, hasReservation, hasStaffCall] = await Promise.all([
        prisma.order.findFirst({ where: { tableId: id }, select: { id: true } }),
        prisma.reservation.findFirst({ where: { tableId: id }, select: { id: true } }),
        prisma.staffCall.findFirst({ where: { tableId: id }, select: { id: true } }),
      ]);
      const reasons = [];
      if (hasOrder) reasons.push('riwayat order');
      if (hasReservation) reasons.push('riwayat reservasi');
      if (hasStaffCall) reasons.push('riwayat panggilan staff');
      const reasonText = reasons.length > 0 ? reasons.join(', ') : 'data terkait';
      throw new AppError(409, `Meja tidak bisa dihapus karena sudah memiliki ${reasonText}. Nonaktifkan lewat isActive saja.`);
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

// Staff floor-status toggle — deliberately not gated behind admin-only like
// the rest of this file's mutations, since this is day-to-day table
// management a kasir does just as much as an admin (unlike creating/
// deleting a table or resetting its QR). See table.routes.js for the
// separate, wider role check this specific action gets.
async function setBillOpen(id, isBillOpen) {
  const existing = await prisma.table.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Meja tidak ditemukan');
  }
  const table = await prisma.table.update({ where: { id }, data: { isBillOpen } });
  return withUrl(table);
}

// Ends the table's current visit, so its bill starts empty for the next
// group instead of still listing the one that already left. Until now a
// visit only ever reset implicitly, on the first order of a genuinely free
// table (order.service.js's bumpVisitIfTableIsFree) — which means a table
// that finished serving and was never reused kept showing the old bill
// indefinitely.
//
// Refuses while orders are still in flight: those are live kitchen/payment
// work, and dropping them off the bill would just lose track of them rather
// than resolve them.
async function clearVisit(id) {
  const existing = await prisma.table.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Meja tidak ditemukan');
  }

  const activeCount = await prisma.order.count({
    where: { tableId: id, status: { in: NON_TERMINAL_STATUSES } },
  });
  if (activeCount > 0) {
    throw new AppError(
      409,
      `Meja ini masih punya ${activeCount} pesanan berjalan. Selesaikan atau batalkan dulu sebelum mengosongkan meja.`
    );
  }

  const table = await prisma.table.update({
    where: { id },
    // isBillOpen resets with it — a cleared table is by definition not
    // waiting to pay any more.
    data: { currentVisitStartedAt: new Date(), isBillOpen: false },
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

  return { id: table.id, nomorMeja: table.nomorMeja, currentVisitStartedAt: table.currentVisitStartedAt };
}

module.exports = { list, create, update, remove, resetToken, setBillOpen, clearVisit, generateQrImage, verifyToken };
