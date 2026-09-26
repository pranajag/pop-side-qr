const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const tableService = require('./table.service');
const realtime = require('../realtime');

function toShaped(call) {
  return {
    id: call.id,
    nomorMeja: call.table.nomorMeja,
    catatan: call.catatan,
    status: call.status,
    createdAt: call.createdAt,
    resolvedAt: call.resolvedAt,
  };
}

async function create(token, catatan) {
  const table = await tableService.verifyToken(token);
  if (!table) {
    throw new AppError(404, 'Meja tidak valid. Coba scan ulang QR.');
  }
  const call = await prisma.staffCall.create({
    data: { tableId: table.id, catatan },
    include: { table: { select: { nomorMeja: true } } },
  });
  realtime.keStaff('panggilan:baru', { id: call.id });
  return toShaped(call);
}

const VALID_STATUSES = new Set(['pending', 'resolved']);

// statusFilter comes straight from req.query.status — must be checked
// against a fixed whitelist before it reaches Prisma's `where`, the same
// rule orderManagement.service.js's buildWhere already follows. Express's
// query parser turns e.g. ?status[not]=pending into an object here, which
// Prisma would otherwise accept as a legal (and attacker-chosen) operator.
async function list(statusFilter) {
  if (statusFilter !== undefined && statusFilter !== 'all' && !VALID_STATUSES.has(statusFilter)) {
    throw new AppError(400, 'Status filter tidak valid');
  }
  const where = statusFilter === 'all' ? {} : { status: statusFilter ?? 'pending' };
  const calls = await prisma.staffCall.findMany({
    where,
    include: { table: { select: { nomorMeja: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return calls.map(toShaped);
}

async function resolve(id, userId) {
  const existing = await prisma.staffCall.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Panggilan tidak ditemukan');
  }
  // Optimistic lock, same pattern as order status transitions — two kasir
  // resolving the same call at once only lets one UPDATE actually match.
  const result = await prisma.staffCall.updateMany({
    where: { id, status: 'pending' },
    data: { status: 'resolved', resolvedAt: new Date(), resolvedBy: userId },
  });
  if (result.count === 0) {
    throw new AppError(409, 'Panggilan ini sudah diselesaikan');
  }
  const call = await prisma.staffCall.findUnique({
    where: { id },
    include: { table: { select: { nomorMeja: true } } },
  });
  realtime.keStaff('panggilan:berubah', { id });
  return toShaped(call);
}

module.exports = { create, list, resolve };
