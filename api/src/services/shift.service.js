const prisma = require('../lib/prisma');
const realtime = require('../realtime');
const AppError = require('../utils/AppError');
const { REVENUE_STATUSES, sumByMetode } = require('./report.service');

async function getActiveShift(userId) {
  return prisma.shift.findFirst({ where: { userId, endedAt: null } });
}

// "Is anyone on duty right now" — any staff, not a specific one. The public
// checkout uses this as its open/closed signal: an order placed while the
// cafe is closed has nobody to confirm it, pay for it, or cook it, so it
// just sits pending until someone finds it the next morning. Counted rather
// than fetched because this runs on every public order and every menu load.
//
// Shift milik akun yang sudah dinonaktifkan tidak dihitung: orangnya tidak
// bisa login lagi untuk mengonfirmasi atau memproses apa pun, jadi kafe
// sebenarnya tidak ada yang jaga — web public harus menganggapnya tutup.
async function isAnyShiftActive() {
  return (await prisma.shift.count({ where: { endedAt: null, user: { isActive: true } } })) > 0;
}

// cashStart: cash float the kasir put in the drawer to start the shift,
// required so expectedCash at endShift can be "what it started with, plus
// today's tunai sales" instead of assuming every drawer starts at zero.
// namaStaff: the actual person on shift, separate from the login account
// (see schema.prisma's own comment) — required for the same "who's really
// accountable for this drawer" reason cashStart is.
//
// Cek "sudah ada shift?" lalu "buat shift" dijalankan di bawah kunci baris
// user (SELECT ... FOR UPDATE, parameterized): tanpa itu, dua klik "Mulai
// Shift" yang nyaris bersamaan (double-tap, dua tab) sama-sama lolos
// pengecekan dan membuka DUA shift untuk satu orang — kasnya jadi terhitung
// dobel. READ COMMITTED supaya pengecekan sesudah kunci melihat shift yang
// baru saja di-commit klik pertama.
// Kafe buka = ada staff yang sedang shift. Begitu shift dimulai/diakhiri,
// HP customer yang sedang membuka menu langsung tahu (realtime.js), tanpa
// menunggu polling status berikutnya.
async function umumkanStatusKafe() {
  realtime.kePublik('kafe:status', { sedangBuka: await isAnyShiftActive() });
  realtime.keStaff('shift:berubah');
}

async function startShift(userId, cashStart, namaStaff) {
  const shift = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const existing = await tx.shift.findFirst({ where: { userId, endedAt: null } });
      if (existing) {
        throw new AppError(409, 'Shift kamu masih berjalan. Akhiri dulu sebelum mulai yang baru.');
      }
      return tx.shift.create({
        data: { userId, cashStart, namaStaff },
        include: { user: { select: { username: true } } },
      });
    },
    { isolationLevel: 'ReadCommitted' }
  );
  umumkanStatusKafe().catch(() => {});
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
  umumkanStatusKafe().catch(() => {});
  return shapeShift(shift);
}

async function getMyActiveShift(userId) {
  const shift = await prisma.shift.findFirst({
    where: { userId, endedAt: null },
    include: { user: { select: { username: true } } },
  });
  return shift ? shapeShift(shift) : null;
}

// Uang sebuah pesanan masuk ke shift staff yang MENERIMA pembayarannya:
// log status "→ confirmed" oleh akun shift ini, di dalam jendela shift ini.
// Bukan "semua pesanan yang dibuat selama shift berjalan" — dengan aturan
// itu dua staff yang shift bersamaan sama-sama menghitung pesanan yang sama
// (uang di laci terhitung dua kali), dan pesanan yang dibuat di shift A tapi
// dibayar di shift B tercatat di laci A. Menerima pembayaran selalu butuh
// shift terbuka milik staff itu (assertActiveShift, createManualOrder), jadi
// setiap pesanan lunas masuk tepat satu shift.
function dibayarDiShift(shift, windowEnd) {
  return {
    statusLogs: {
      some: {
        statusTo: 'confirmed',
        changedBy: shift.userId,
        createdAt: { gte: shift.startedAt, lt: windowEnd },
      },
    },
  };
}

// Shift yang menerima satu pembayaran DP: shift pencatatnya yang sedang
// berjalan saat itu (mencatat DP mewajibkan shift — reservation.service.js
// assertShiftBerjalan). Cadangan untuk data yang tidak punya pencatat
// ber-shift (catatan lama sebelum aturan itu, akun yang sudah dihapus):
// shift yang paling awal dimulai di antara yang berjalan saat itu — tetap
// tepat satu shift, tidak terhitung dua kali.
async function shiftPenerimaDp(pembayaran) {
  const berjalan = {
    startedAt: { lte: pembayaran.paidAt },
    OR: [{ endedAt: null }, { endedAt: { gt: pembayaran.paidAt } }],
  };
  if (pembayaran.recordedBy !== null) {
    const milikPencatat = await prisma.shift.findFirst({
      where: { ...berjalan, userId: pembayaran.recordedBy },
      select: { id: true },
    });
    if (milikPencatat) return milikPencatat.id;
  }
  const pertama = await prisma.shift.findFirst({
    where: berjalan,
    orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  return pertama?.id ?? null;
}

// Live stats for an open shift (window end = now) and final stats for a
// closed one (window end = endedAt) share this one code path — same
// revenue rule report.service.js uses, just windowed differently.
async function shapeShift(shift) {
  const windowEnd = shift.endedAt ?? new Date();
  const orders = await prisma.order.findMany({
    where: { status: { in: REVENUE_STATUSES }, ...dibayarDiShift(shift, windowEnd) },
    select: { metode: true, totalHarga: true },
  });
  const { byMetode, total: revenue } = sumByMetode(orders);

  // DP reservasi yang dicatat lunas di dalam jendela shift ini — uang yang
  // benar-benar diterima di shift ini, walau acaranya baru berlangsung
  // nanti. Jendelanya sama persis dengan order di atas (depositPaidAt, bukan
  // tanggal reservasi), jadi DP yang diterima shift pagi tidak nyasar ke
  // shift malam. Status reservasinya sekarang tidak mengubah fakta bahwa
  // uangnya sudah masuk: tidak ada pencatatan refund DP di sistem ini.
  //
  // Setiap pembayaran DP dihitung sendiri-sendiri, termasuk cicilan: uang
  // Rp 50.000 yang diterima di shift pagi memang ada di laci shift pagi,
  // walau DP-nya baru lunas di shift malam. Kalau beberapa shift berjalan
  // bersamaan, DP masuk ke satu shift saja (shiftPenerimaDp).
  const kandidatDp = await prisma.reservationDepositPayment.findMany({
    where: { paidAt: { gte: shift.startedAt, lt: windowEnd } },
    orderBy: { paidAt: 'asc' },
    select: {
      amount: true,
      metode: true,
      paidAt: true,
      recordedBy: true,
      reservation: {
        select: {
          id: true,
          namaCustomer: true,
          tanggalReservasi: true,
          depositPaid: true,
          table: { select: { nomorMeja: true } },
        },
      },
    },
  });
  const penerima = await Promise.all(kandidatDp.map(shiftPenerimaDp));
  const deposits = kandidatDp.filter((_, i) => penerima[i] === shift.id);
  const depositByMetode = { qris: 0, tunai: 0, debit: 0 };
  for (const d of deposits) {
    if (d.metode in depositByMetode) depositByMetode[d.metode] += Number(d.amount);
  }
  // Rincian untuk bagian "DP reservasi" di halaman Shift: siapa, berapa,
  // lewat apa, dan apakah DP-nya sekarang sudah lunas.
  const depositList = deposits.map((d) => ({
    reservationId: d.reservation.id,
    namaCustomer: d.reservation.namaCustomer,
    nomorMeja: d.reservation.table?.nomorMeja ?? null,
    tanggalReservasi: d.reservation.tanggalReservasi,
    amount: Number(d.amount),
    metode: d.metode,
    paidAt: d.paidAt,
    lunas: d.reservation.depositPaid,
  }));
  const depositTotal = depositByMetode.qris + depositByMetode.tunai + depositByMetode.debit;

  // Only `tunai` is physical cash in the drawer — qris/debit money never
  // touches it. What SHOULD be in the drawer at shift end is what it
  // started with (cashStart) plus that tunai revenue, not tunai revenue
  // alone — otherwise every shift would look short by exactly its own
  // starting float. cashStart is null only for shifts started before this
  // field existed, in which case this falls back to the old zero-start
  // assumption for that historical data.
  const cashStart = shift.cashStart == null ? null : Number(shift.cashStart);
  // DP tunai juga uang fisik di laci, jadi ikut dihitung — kalau tidak,
  // setiap shift yang menerima DP tunai akan tercatat "lebih".
  const expectedCash = (cashStart ?? 0) + byMetode.tunai + depositByMetode.tunai;
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
    // DP reservasi terpisah dari penjualan (revenue/byMetode tidak berubah
    // artinya — laporan pendapatan tetap bicara penjualan), lalu dijumlah
    // di totalMasuk: seluruh uang yang masuk selama shift ini.
    depositByMetode,
    depositTotal,
    depositCount: deposits.length,
    depositList,
    totalMasuk: revenue + (onlineSalesAmount ?? 0) + depositTotal,
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
  // Sama dengan ringkasannya: pesanan tunai yang pembayarannya diterima
  // staff shift ini, lalu dibatalkan.
  const cancelledTunai = await prisma.order.findMany({
    where: {
      metode: 'tunai',
      status: 'cancelled',
      ...dibayarDiShift(shift, windowEnd),
    },
    select: {
      kodeOrder: true,
      totalHarga: true,
      refundAmount: true,
      updatedAt: true,
      statusLogs: { select: { statusTo: true, catatan: true } },
    },
  });
  const cancelledAfterConfirm = cancelledTunai.map((o) => ({
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
  isAnyShiftActive,
  startShift,
  endShift,
  getMyActiveShift,
  listActiveShifts,
  listShifts,
  getShiftDetail,
};
