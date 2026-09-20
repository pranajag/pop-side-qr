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
    depositAmount: reservation.depositAmount === null ? 0 : Number(reservation.depositAmount),
    depositPaid: reservation.depositPaid,
    depositMetode: reservation.depositMetode,
    depositPaidAt: reservation.depositPaidAt,
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

// There's no separate "duration" field on a reservation — just one
// timestamp — so "double-booked" is approximated as another still-live
// (pending/confirmed) reservation on the same table within one rough
// seating window of this one. Wide enough to catch the real case this
// guards against (two different staff booking the same table for two
// separate evening events) without flagging a legitimate lunch-then-dinner
// turnover on the same table, same day.
const BOOKING_WINDOW_MS = 3 * 60 * 60 * 1000;

async function assertNoDoubleBooking(tableId, tanggalReservasi, excludeId) {
  if (tableId === null || tableId === undefined) return;
  const target = new Date(tanggalReservasi);
  const conflict = await prisma.reservation.findFirst({
    where: {
      tableId,
      status: { in: ['pending', 'confirmed'] },
      ...(excludeId ? { id: { not: excludeId } } : {}),
      tanggalReservasi: {
        gte: new Date(target.getTime() - BOOKING_WINDOW_MS),
        lte: new Date(target.getTime() + BOOKING_WINDOW_MS),
      },
    },
  });
  if (conflict) {
    throw new AppError(
      409,
      `Meja ini sudah ada reservasi lain (${conflict.namaCustomer}) di sekitar jam yang sama. Pilih meja lain atau ubah jamnya.`
    );
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
  await assertNoDoubleBooking(data.tableId ?? null, data.tanggalReservasi);
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
  const nextTanggal = data.tanggalReservasi !== undefined ? data.tanggalReservasi : existing.tanggalReservasi;
  await assertTableFits(nextTableId, nextJumlahTamu);
  await assertNoDoubleBooking(nextTableId, nextTanggal, id);

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

// Staff-recorded (see schema.prisma's depositMetode comment for why this
// has no QRIS-proof-upload step like a real Order does) — a plain "yes,
// this deposit actually came in, here's how" toggle. Deliberately doesn't
// require a deposit to already be set >0 on the reservation: staff might
// reasonably collect one on the spot that wasn't planned for at booking
// time.
async function setDepositPaid(id, metode) {
  const existing = await prisma.reservation.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Reservasi tidak ditemukan');
  }
  const reservation = await prisma.reservation.update({
    where: { id },
    data: { depositPaid: true, depositMetode: metode, depositPaidAt: new Date() },
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

module.exports = { list, get, create, update, updateStatus, setDepositPaid, remove };
