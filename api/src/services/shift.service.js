const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { REVENUE_STATUSES, sumByMetode } = require('./report.service');

async function getActiveShift(userId) {
  return prisma.shift.findFirst({ where: { userId, endedAt: null } });
}

// cashStart: cash float the kasir put in the drawer to start the shift,
// required so expectedCash at endShift can be "what it started with, plus
// today's tunai sales" instead of assuming every drawer starts at zero.
// namaStaff: the actual person on shift, separate from the login account
// (see schema.prisma's own comment) — required for the same "who's really
// accountable for this drawer" reason cashStart is.
async function startShift(userId, cashStart, namaStaff) {
  const existing = await getActiveShift(userId);
  if (existing) {
    throw new AppError(409, 'Shift kamu masih berjalan. Akhiri dulu sebelum mulai yang baru.');
  }
  const shift = await prisma.shift.create({
    data: { userId, cashStart, namaStaff },
    include: { user: { select: { username: true } } },
  });
  return shapeShift(shift);
}

// cashCounted: physical cash the kasir counted in the drawer, required so
// every closed shift has a real reconciliation, not a silent "unknown".
// gojekAmount/grabfoodAmount: marketplace sales for the shift, entered
// manually since those orders never pass through this system.
async function endShift(userId, cashCounted, gojekAmount, grabfoodAmount) {
  const active = await getActiveShift(userId);
  if (!active) {
    throw new AppError(409, 'Tidak ada shift yang sedang berjalan.');
  }
  const shift = await prisma.shift.update({
    where: { id: active.id },
    data: { endedAt: new Date(), cashCounted, gojekAmount, grabfoodAmount },
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
  // touches it. What SHOULD be in the drawer at shift end is what it
  // started with (cashStart) plus that tunai revenue, not tunai revenue
  // alone — otherwise every shift would look short by exactly its own
  // starting float. cashStart is null only for shifts started before this
  // field existed, in which case this falls back to the old zero-start
  // assumption for that historical data.
  const cashStart = shift.cashStart == null ? null : Number(shift.cashStart);
  const expectedCash = (cashStart ?? 0) + byMetode.tunai;
  const cashCounted = shift.cashCounted == null ? null : Number(shift.cashCounted);
  const cashDifference = cashCounted === null ? null : cashCounted - expectedCash;
  const gojekAmount = shift.gojekAmount == null ? null : Number(shift.gojekAmount);
  const grabfoodAmount = shift.grabfoodAmount == null ? null : Number(shift.grabfoodAmount);
  const onlineSalesAmount = gojekAmount === null && grabfoodAmount === null ? null : (gojekAmount ?? 0) + (grabfoodAmount ?? 0);

  return {
    id: shift.id,
    username: shift.user.username,
    namaStaff: shift.namaStaff,
    startedAt: shift.startedAt,
    endedAt: shift.endedAt,
    isActive: shift.endedAt === null,
    orderCount: orders.length,
    revenue,
    byMetode,
    cashStart,
    expectedCash,
    cashCounted,
    cashDifference,
    isMinus: cashDifference !== null && cashDifference < 0,
    // Informational only — never part of expectedCash/cashDifference, since
    // neither was ever expected to be physical cash in the drawer.
    gojekAmount,
    grabfoodAmount,
    // Derived convenience total (gojek + grabfood) for callers that only
    // care about "online sales" as a whole, e.g. totalRevenueWithOnline.
    onlineSalesAmount,
    totalRevenueWithOnline: revenue + (onlineSalesAmount ?? 0),
  };
}

// Every shift currently open right now, across all staff — not scoped to
// one userId like getActiveShift/getMyActiveShift above, since this is for
// dashboard.service.js's admin overview (multiple kasir can have a shift
// open at once) rather than "does THIS user have one running".
async function listActiveShifts() {
  const shifts = await prisma.shift.findMany({
    where: { endedAt: null },
    include: { user: { select: { username: true } } },
    orderBy: { startedAt: 'asc' },
  });
  return Promise.all(shifts.map(shapeShift));
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
      refundAmount: true,
      updatedAt: true,
      statusLogs: { select: { statusTo: true, catatan: true } },
    },
  });
  const cancelledAfterConfirm = cancelledTunai
    .filter((o) => o.statusLogs.some((log) => log.statusTo === 'confirmed'))
    .map((o) => ({
      kodeOrder: o.kodeOrder,
      totalHarga: Number(o.totalHarga),
      refundAmount: o.refundAmount === null ? null : Number(o.refundAmount),
      cancelledAt: o.updatedAt,
      alasan: o.statusLogs.find((log) => log.statusTo === 'cancelled')?.catatan ?? null,
    }));

  return { ...summary, cancelledAfterConfirm };
}

module.exports = {
  getActiveShift,
  startShift,
  endShift,
  getMyActiveShift,
  listActiveShifts,
  listShifts,
  getShiftDetail,
};
