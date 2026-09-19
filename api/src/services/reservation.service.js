const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');

const INCLUDE_TABLE = { table: { select: { nomorMeja: true, kapasitas: true } } };

function toShaped(reservation) {
  return {
    id: reservation.id,
    namaCustomer: reservation.namaCustomer,
    namaAcara: reservation.namaAcara,
    telepon: reservation.telepon,
    jumlahTamu: reservation.jumlahTamu,
    tanggalReservasi: reservation.tanggalReservasi,
    tableId: reservation.tableId,
    nomorMeja: reservation.table?.nomorMeja ?? null,
    kapasitasMeja: reservation.table?.kapasitas ?? null,
    status: reservation.status,
    catatan: reservation.catatan,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
  };
}

// Guards the whole point of tracking kapasitas per table (MEMORY.md /
// AGENTS.md request) — a table assignment that can't actually seat the
// party is caught here, not left for staff to discover on the day.
async function assertTableFits(tableId, jumlahTamu) {
  if (tableId === null || tableId === undefined) return;
  const table = await prisma.table.findUnique({ where: { id: tableId } });
  if (!table) {
    throw new AppError(404, 'Meja tidak ditemukan');
  }
  if (jumlahTamu > table.kapasitas) {
    throw new AppError(409, `Meja ${table.nomorMeja} cuma muat ${table.kapasitas} orang, reservasi ini untuk ${jumlahTamu} orang`);
  }
}

const VALID_STATUSES = new Set(['pending', 'confirmed', 'cancelled', 'completed']);

// statusFilter comes straight from req.query.status — whitelisted before it
// reaches Prisma's `where`, same rule as staffCall.service.js/
// orderManagement.service.js (an unchecked value could otherwise smuggle a
// Prisma operator object through Express's query parser).
async function list(statusFilter) {
  if (statusFilter !== undefined && statusFilter !== 'all' && !VALID_STATUSES.has(statusFilter)) {
    throw new AppError(400, 'Status filter tidak valid');
  }
  const where = statusFilter === undefined || statusFilter === 'all' ? {} : { status: statusFilter };
  const reservations = await prisma.reservation.findMany({
    where,
    include: INCLUDE_TABLE,
    orderBy: { tanggalReservasi: 'asc' },
  });
  return reservations.map(toShaped);
}

async function get(id) {
  const reservation = await prisma.reservation.findUnique({ where: { id }, include: INCLUDE_TABLE });
  if (!reservation) {
    throw new AppError(404, 'Reservasi tidak ditemukan');
  }
  return toShaped(reservation);
}

async function create(data) {
  await assertTableFits(data.tableId ?? null, data.jumlahTamu);
  const reservation = await prisma.reservation.create({
    data: { ...data, tableId: data.tableId ?? null },
    include: INCLUDE_TABLE,
  });
  return toShaped(reservation);
}

async function update(id, data) {
  const existing = await prisma.reservation.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Reservasi tidak ditemukan');
  }
  const nextTableId = data.tableId !== undefined ? data.tableId : existing.tableId;
  const nextJumlahTamu = data.jumlahTamu !== undefined ? data.jumlahTamu : existing.jumlahTamu;
  await assertTableFits(nextTableId, nextJumlahTamu);

  const reservation = await prisma.reservation.update({ where: { id }, data, include: INCLUDE_TABLE });
  return toShaped(reservation);
}

async function updateStatus(id, status) {
  const existing = await prisma.reservation.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Reservasi tidak ditemukan');
  }
  const reservation = await prisma.reservation.update({
    where: { id },
    data: { status },
    include: INCLUDE_TABLE,
  });
  return toShaped(reservation);
}

async function remove(id) {
  const existing = await prisma.reservation.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Reservasi tidak ditemukan');
  }
  await prisma.reservation.delete({ where: { id } });
}

module.exports = { list, get, create, update, updateStatus, remove };
