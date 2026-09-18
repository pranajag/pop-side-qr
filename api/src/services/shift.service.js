const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { REVENUE_STATUSES, sumByMetode } = require('./report.service');

async function getActiveShift(userId) {
  return prisma.shift.findFirst({ where: { userId, endedAt: null } });
}

async function startShift(userId) {
  const existing = await getActiveShift(userId);
  if (existing) {
    throw new AppError(409, 'Shift kamu masih berjalan. Akhiri dulu sebelum mulai yang baru.');
  }
  const shift = await prisma.shift.create({ data: { userId }, include: { user: { select: { username: true } } } });
  return shapeShift(shift);
}

// cashCounted: physical cash the kasir counted in the drawer, required so
// every closed shift has a real reconciliation, not a silent "unknown".
async function endShift(userId, cashCounted) {
  const active = await getActiveShift(userId);
  if (!active) {
    throw new AppError(409, 'Tidak ada shift yang sedang berjalan.');
  }
  const shift = await prisma.shift.update({
    where: { id: active.id },
    data: { endedAt: new Date(), cashCounted },
    include: { user: { select: { username: true } } },
  });
  return shapeShift(shift);
}

async function getMyActiveShift(userId) {
  const shift = await prisma.shift.findFirst({
    where: { userId, endedAt: null },
    include: { user: { select: { username: true } } },
  });
  return shift ? shapeShift(shift) : null;
}

// Live stats for an open shift (window end = now) and final stats for a
// closed one (window end = endedAt) share this one code path — same
// revenue rule report.service.js uses, just windowed differently.
async function shapeShift(shift) {
  const windowEnd = shift.endedAt ?? new Date();
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: shift.startedAt, lt: windowEnd },
      status: { in: REVENUE_STATUSES },
    },
    select: { metode: true, totalHarga: true },
  });
  const { byMetode, total: revenue } = sumByMetode(orders);

  // Only `tunai` is physical cash in the drawer — qris/debit money never
  // touches it, so only tunai revenue is ever expected to reconcile against
  // a cash count.
  const expectedCash = byMetode.tunai;
  const cashCounted = shift.cashCounted == null ? null : Number(shift.cashCounted);
  const cashDifference = cashCounted === null ? null : cashCounted - expectedCash;

  return {
    id: shift.id,
    username: shift.user.username,
    startedAt: shift.startedAt,
    endedAt: shift.endedAt,
    isActive: shift.endedAt === null,
    orderCount: orders.length,
    revenue,
    byMetode,
    expectedCash,
    cashCounted,
    cashDifference,
    isMinus: cashDifference !== null && cashDifference < 0,
  };
}

async function listShifts(limit) {
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const shifts = await prisma.shift.findMany({
    take: capped,
    orderBy: { id: 'desc' },
    include: { user: { select: { username: true } } },
  });
  return Promise.all(shifts.map(shapeShift));
}

// Breakdown for one shift plus a list of candidate explanations for a cash
// shortfall: tunai orders that reached `confirmed` (kasir believed cash was
// in hand) before later being cancelled — the one concrete, non-speculative
// signal this system can surface, since a cancelled-but-never-confirmed
// order never implied cash changed hands in the first place. This is a
// list of *candidates*, not a diagnosis — the actual cause still needs a
// human to check (wrong change given, cash not returned on cancel, etc).
async function getShiftDetail(shiftId) {
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: { user: { select: { username: true } } },
  });
  if (!shift) {
    throw new AppError(404, 'Shift tidak ditemukan');
  }
  const summary = await shapeShift(shift);

  const windowEnd = shift.endedAt ?? new Date();
  const cancelledTunai = await prisma.order.findMany({
    where: {
      createdAt: { gte: shift.startedAt, lt: windowEnd },
      metode: 'tunai',
      status: 'cancelled',
    },
    select: {
      kodeOrder: true,
      totalHarga: true,
      updatedAt: true,
      statusLogs: { select: { statusTo: true, catatan: true } },
    },
  });
  const cancelledAfterConfirm = cancelledTunai
    .filter((o) => o.statusLogs.some((log) => log.statusTo === 'confirmed'))
    .map((o) => ({
      kodeOrder: o.kodeOrder,
      totalHarga: Number(o.totalHarga),
      cancelledAt: o.updatedAt,
      alasan: o.statusLogs.find((log) => log.statusTo === 'cancelled')?.catatan ?? null,
    }));

  return { ...summary, cancelledAfterConfirm };
}

module.exports = { startShift, endShift, getMyActiveShift, listShifts, getShiftDetail };
