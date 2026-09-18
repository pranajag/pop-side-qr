const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { REVENUE_STATUSES } = require('./report.service');

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

async function endShift(userId) {
  const active = await getActiveShift(userId);
  if (!active) {
    throw new AppError(409, 'Tidak ada shift yang sedang berjalan.');
  }
  const shift = await prisma.shift.update({
    where: { id: active.id },
    data: { endedAt: new Date() },
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
    select: { totalHarga: true },
  });
  const revenue = orders.reduce((sum, o) => sum + Number(o.totalHarga), 0);

  return {
    id: shift.id,
    username: shift.user.username,
    startedAt: shift.startedAt,
    endedAt: shift.endedAt,
    isActive: shift.endedAt === null,
    orderCount: orders.length,
    revenue,
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

module.exports = { startShift, endShift, getMyActiveShift, listShifts };
