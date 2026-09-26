const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const shiftService = require('./shift.service');
const settingsService = require('./settings.service');
const { enkripsi, dekripsi } = require('../utils/kripto');
const realtime = require('../realtime');

// Nomor HP customer reservasi hanya disimpan terenkripsi. `telepon` dari
// request diubah jadi `teleponEnc` di sini, satu-satunya jalan masuknya.
function denganTeleponTerenkripsi(data) {
  if (!Object.prototype.hasOwnProperty.call(data, 'telepon')) return data;
  const { telepon, ...lainnya } = data;
  return { ...lainnya, teleponEnc: telepon ? enkripsi(telepon) : null };
}

// Pelaku = staff yang login ({ id, role }). Angka polos (id saja) masih
// diterima untuk pemanggil lama; perannya dianggap tidak diketahui, jadi
// tidak pernah diperlakukan sebagai admin.
function pelakuDari(pelaku) {
  return pelaku && typeof pelaku === 'object' ? pelaku : { id: pelaku ?? null, role: null };
}

// DP wajib di bawah aturan toko = keputusan soal uang toko: hanya admin
// yang boleh, dan alasannya wajib tercatat (juga masuk log audit lewat
// request-nya). Tanpa ini kasir bisa diam-diam membebaskan DP siapa pun.
function periksaPotonganDp({ depositAmount, dpAturan, pelaku, alasanDp }) {
  if (depositAmount >= dpAturan) return null;
  if (pelaku.role !== 'admin') {
    throw new AppError(
      403,
      `DP wajib reservasi ini ${rupiah(dpAturan)} (aturan toko). Hanya admin yang bisa mengurangi atau membebaskannya.`
    );
  }
  if (!alasanDp) {
    throw new AppError(400, `Isi alasan kenapa DP di bawah aturan toko (${rupiah(dpAturan)}).`);
  }
  return alasanDp;
}

const INCLUDE_TABLE = {
  table: { select: { nomorMeja: true, kapasitas: true } },
  depositPayments: {
    orderBy: { paidAt: 'asc' },
    select: { id: true, amount: true, metode: true, paidAt: true, recordedByUser: { select: { username: true } } },
  },
};

const rupiah = (n) => `Rp ${new Intl.NumberFormat('id-ID').format(n)}`;

// READ COMMITTED: setiap bacaan di dalam transaksi melihat data terbaru yang
// sudah di-commit, jadi setelah kunci baris didapat, cicilan yang baru saja
// dicatat staff lain pasti ikut terhitung.
const TRANSAKSI_DP = { isolationLevel: 'ReadCommitted' };

// wajib   = DP yang harus dibayar (kolom deposit_amount).
// dibayar = jumlah semua pembayaran DP yang sudah dicatat.
// Status: tidak_perlu (tidak ada DP wajib) | belum | sebagian | lunas.
function ringkasanDp(reservation) {
  const wajib = reservation.depositAmount === null ? 0 : Number(reservation.depositAmount);
  const dibayar = (reservation.depositPayments ?? []).reduce((s, pb) => s + Number(pb.amount), 0);
  const kurang = Math.max(0, wajib - dibayar);
  let status = 'tidak_perlu';
  if (wajib > 0) status = dibayar >= wajib ? 'lunas' : dibayar > 0 ? 'sebagian' : 'belum';
  return { wajib, dibayar, kurang, status };
}

function hitungDpWajib(aturan, jumlahTamu) {
  return aturan.perTamu ? aturan.nominal * jumlahTamu : aturan.nominal;
}

// Uang DP dihitung ke rekap shift staff yang mencatatnya, yang sedang
// berjalan saat diterima (shift.service.js shiftPenerimaDp). Tanpa shift,
// uangnya masuk laci tapi tidak jelas masuk rekap shift siapa.
async function assertShiftBerjalan(userId) {
  if (!(await shiftService.getActiveShift(userId))) {
    throw new AppError(403, 'Mulai shift dulu sebelum mencatat DP — DP harus masuk hitungan kas shift.');
  }
}

function toShaped(reservation) {
  return {
    id: reservation.id,
    namaCustomer: reservation.namaCustomer,
    namaAcara: reservation.namaAcara,
    telepon: reservation.teleponEnc ? dekripsi(reservation.teleponEnc) : null,
    alasanDp: reservation.alasanDp,
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
    dp: ringkasanDp(reservation),
    pembayaranDp: (reservation.depositPayments ?? []).map((pb) => ({
      id: pb.id,
      amount: Number(pb.amount),
      metode: pb.metode,
      paidAt: pb.paidAt,
      dicatatOleh: pb.recordedByUser?.username ?? null,
    })),
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

// Reservasi yang masih "memegang" mejanya.
const STATUS_AKTIF = new Set(['pending', 'confirmed']);

//
// Wajib dipanggil di dalam $transaction (isolasi READ COMMITTED, lihat
// TRANSAKSI_DP) dengan `tx`-nya, dan langkah pertamanya MENGUNCI baris meja:
// dua staff yang membooking meja yang sama pada saat bersamaan harus antre.
// Tanpa kunci, keduanya sama-sama melihat "belum ada reservasi" lalu
// sama-sama menyimpan — uji balapan: 3 booking bersamaan untuk meja & jam
// yang sama, ketiganya tersimpan. Yang antre di belakang baru membaca
// setelah yang pertama commit, jadi bentroknya terlihat.
async function assertNoDoubleBooking(tx, tableId, tanggalReservasi, excludeId) {
  if (tableId === null || tableId === undefined) return;
  await tx.$queryRaw`SELECT id FROM tables WHERE id = ${tableId} FOR UPDATE`;
  const target = new Date(tanggalReservasi);
  const conflict = await tx.reservation.findFirst({
    where: {
      tableId,
      status: { in: [...STATUS_AKTIF] },
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

async function create(data, pelakuMentah) {
  const pelaku = pelakuDari(pelakuMentah);
  const userId = pelaku.id;
  const { dpDibayarSekarang, metodeDp, alasanDp, ...sisa } = data;
  const isi = denganTeleponTerenkripsi(sisa);
  await assertTableFits(isi.tableId ?? null, isi.jumlahTamu);
  // DP wajib yang tidak diisi staff mengikuti aturan toko. Yang diisi di
  // bawah aturan itu (termasuk 0 = dibebaskan) hanya boleh oleh admin,
  // dengan alasan.
  const dpAturan = hitungDpWajib(await settingsService.getAturanDp(), isi.jumlahTamu);
  if (isi.depositAmount === undefined) isi.depositAmount = dpAturan;
  isi.alasanDp = periksaPotonganDp({ depositAmount: isi.depositAmount, dpAturan, pelaku, alasanDp });
  const bayar = dpDibayarSekarang ?? 0;
  if (bayar > 0) {
    await assertShiftBerjalan(userId);
    if (isi.depositAmount <= 0) {
      throw new AppError(400, 'Reservasi ini tidak memerlukan DP — isi DP wajibnya dulu kalau memang ada DP.');
    }
    if (bayar > isi.depositAmount) {
      throw new AppError(400, `DP yang dibayar (${rupiah(bayar)}) melebihi DP wajib (${rupiah(isi.depositAmount)}).`);
    }
  }

  let hasilBayar = { baruLunas: false, dikonfirmasiOtomatis: false };
  const id = await prisma.$transaction(async (tx) => {
    await assertNoDoubleBooking(tx, isi.tableId ?? null, isi.tanggalReservasi);
    const dibuat = await tx.reservation.create({ data: { ...isi, tableId: isi.tableId ?? null } });
    if (bayar > 0) hasilBayar = await catatDalamTransaksi(tx, dibuat.id, bayar, metodeDp, userId);
    return dibuat.id;
  }, TRANSAKSI_DP);
  const reservation = await prisma.reservation.findUnique({ where: { id }, include: INCLUDE_TABLE });
  realtime.keStaff('reservasi:berubah', { id: reservation.id });
  return { reservation: toShaped(reservation), ...hasilBayar };
}

// Dijalankan di dalam $transaction (isolasi READ COMMITTED, lihat
// TRANSAKSI_DP). Langkah pertamanya MENGUNCI baris reservasi: dua staff yang
// mencatat cicilan untuk reservasi yang sama pada saat bersamaan harus
// antre — kalau tidak, keduanya sama-sama melihat "kurang Rp 50.000" dan
// masing-masing mencatat Rp 50.000, sehingga DP terbayar dua kali lipat.
//
// Kuncinya SELECT ... FOR UPDATE lewat $queryRaw bertanda (tagged
// template: Prisma mengirim ${id} sebagai parameter, bukan menyambung
// string — AGENTS.md aturan #1). Sengaja bukan tx.reservation.update():
// uji balapan membuktikan update() Prisma membaca barisnya dulu sebelum
// UPDATE, sehingga di REPEATABLE READ snapshot transaksi sudah terbentuk
// sebelum kunci didapat, dan cicilan staff lain tidak terlihat — dua
// pembayaran Rp 60.000 sama-sama lolos untuk DP Rp 100.000.
async function catatDalamTransaksi(tx, id, amount, metode, userId) {
  await tx.$queryRaw`SELECT id FROM reservations WHERE id = ${id} FOR UPDATE`;
  const r = await tx.reservation.findUnique({
    where: { id },
    include: { depositPayments: { select: { amount: true } } },
  });
  if (r.status === 'cancelled') {
    throw new AppError(409, 'Reservasi ini sudah dibatalkan — tidak bisa menerima DP.');
  }
  const { wajib, dibayar, kurang } = ringkasanDp(r);
  if (wajib <= 0) {
    throw new AppError(400, 'Reservasi ini tidak memerlukan DP — isi DP wajibnya dulu kalau memang ada DP.');
  }
  if (kurang <= 0) {
    throw new AppError(409, 'DP reservasi ini sudah lunas.');
  }
  if (amount > kurang) {
    throw new AppError(400, `Melebihi kekurangan DP — sisa yang harus dibayar ${rupiah(kurang)}.`);
  }

  await tx.reservationDepositPayment.create({
    data: { reservationId: id, amount, metode, recordedBy: userId },
  });

  const lunas = dibayar + amount >= wajib;
  // Aturan membuka reservasi: begitu DP wajib lunas, reservasi yang masih
  // pending otomatis dikonfirmasi — mejanya resmi ditahan untuk mereka.
  const dikonfirmasiOtomatis = lunas && r.status === 'pending';
  if (lunas) {
    await tx.reservation.update({
      where: { id },
      data: {
        depositPaid: true,
        depositPaidAt: new Date(),
        depositMetode: metode,
        ...(dikonfirmasiOtomatis ? { status: 'confirmed' } : {}),
      },
    });
  }
  return { baruLunas: lunas, dikonfirmasiOtomatis, kurang: Math.max(0, wajib - dibayar - amount) };
}

async function catatPembayaranDp(id, { amount, metode }, userId) {
  await assertShiftBerjalan(userId);
  const ada = await prisma.reservation.findUnique({ where: { id }, select: { id: true } });
  if (!ada) {
    throw new AppError(404, 'Reservasi tidak ditemukan');
  }
  const hasilBayar = await prisma.$transaction(
    (tx) => catatDalamTransaksi(tx, id, amount, metode, userId),
    TRANSAKSI_DP
  );
  const reservation = await prisma.reservation.findUnique({ where: { id }, include: INCLUDE_TABLE });
  realtime.keStaff('reservasi:berubah', { id: reservation.id });
  return { reservation: toShaped(reservation), ...hasilBayar };
}

// Membuka transaksi yang mengunci baris reservasi `id` lebih dulu, lalu
// menjalankan `kerja(tx, existing)`. Edit data, ganti status, dan pencatatan
// cicilan DP (catatDalamTransaksi) untuk reservasi yang sama jadi antre —
// setiap pengecekan di dalamnya memakai angka terbaru, bukan angka yang
// sudah basi karena staff lain menyimpan di detik yang sama.
async function denganReservasiTerkunci(id, kerja) {
  return prisma.$transaction(async (tx) => {
    const terkunci = await tx.$queryRaw`SELECT id FROM reservations WHERE id = ${id} FOR UPDATE`;
    if (terkunci.length === 0) {
      throw new AppError(404, 'Reservasi tidak ditemukan');
    }
    const existing = await tx.reservation.findUnique({ where: { id } });
    return kerja(tx, existing);
  }, TRANSAKSI_DP);
}

async function update(id, dataMentah, pelakuMentah) {
  const pelaku = pelakuDari(pelakuMentah);
  const { alasanDp, ...sisa } = dataMentah;
  const data = denganTeleponTerenkripsi(sisa);
  const reservation = await denganReservasiTerkunci(id, async (tx, existing) => {
    const nextTableId = data.tableId !== undefined ? data.tableId : existing.tableId;
    const nextJumlahTamu = data.jumlahTamu !== undefined ? data.jumlahTamu : existing.jumlahTamu;
    const nextTanggal = data.tanggalReservasi !== undefined ? data.tanggalReservasi : existing.tanggalReservasi;
    await assertTableFits(nextTableId, nextJumlahTamu);
    await assertNoDoubleBooking(tx, nextTableId, nextTanggal, id);

    let isi = data;
    // Diperiksa setiap kali DP wajib ATAU jumlah tamu berubah — bukan hanya
    // DP-nya: menaikkan jumlah tamu (aturan DP per tamu) sambil membiarkan
    // DP tetap kecil sama saja dengan membebaskan sebagian DP.
    if (data.depositAmount !== undefined || data.jumlahTamu !== undefined) {
      const dpAturan = hitungDpWajib(await settingsService.getAturanDp(tx), nextJumlahTamu);
      const dpBaru = data.depositAmount !== undefined ? data.depositAmount : Number(existing.depositAmount ?? 0);
      isi = { ...isi, alasanDp: periksaPotonganDp({ depositAmount: dpBaru, dpAturan, pelaku, alasanDp: alasanDp ?? existing.alasanDp }) };
    }

    // DP wajib boleh diubah, tapi ringkasan lunasnya ikut dihitung ulang —
    // dan tidak boleh turun di bawah uang yang sudah diterima (kalau tidak,
    // reservasi tercatat "lebih bayar" tanpa ada yang mengembalikan).
    if (data.depositAmount !== undefined) {
      const payments = await tx.reservationDepositPayment.findMany({ where: { reservationId: id }, select: { amount: true } });
      const dibayar = payments.reduce((s, pb) => s + Number(pb.amount), 0);
      if (data.depositAmount < dibayar) {
        throw new AppError(400, `DP wajib tidak boleh lebih kecil dari DP yang sudah dibayar (${rupiah(dibayar)}).`);
      }
      const lunas = data.depositAmount > 0 && dibayar >= data.depositAmount;
      isi = {
        ...isi,
        depositPaid: lunas,
        depositPaidAt: lunas ? existing.depositPaidAt ?? new Date() : null,
      };
    }

    return tx.reservation.update({ where: { id }, data: isi, include: INCLUDE_TABLE });
  });
  realtime.keStaff('reservasi:berubah', { id: reservation.id });
  return toShaped(reservation);
}

async function updateStatus(id, status) {
  const reservation = await denganReservasiTerkunci(id, async (tx, existing) => {
    // Mengaktifkan lagi reservasi yang sudah batal/selesai = membooking
    // mejanya lagi — bisa saja meja & jam itu sudah diambil reservasi lain.
    if (STATUS_AKTIF.has(status) && !STATUS_AKTIF.has(existing.status)) {
      await assertNoDoubleBooking(tx, existing.tableId, existing.tanggalReservasi, id);
    }
    return tx.reservation.update({ where: { id }, data: { status }, include: INCLUDE_TABLE });
  });
  realtime.keStaff('reservasi:berubah', { id: reservation.id });
  return toShaped(reservation);
}


async function remove(id) {
  const existing = await prisma.reservation.findUnique({ where: { id }, include: { depositPayments: { select: { amount: true } } } });
  if (!existing) {
    throw new AppError(404, 'Reservasi tidak ditemukan');
  }
  const { dibayar } = ringkasanDp(existing);
  if (dibayar > 0) {
    throw new AppError(
      409,
      `Reservasi ini sudah menerima DP ${rupiah(dibayar)} — ubah statusnya ke Dibatalkan saja, jangan dihapus, supaya rekap shift yang mencatat uang itu tetap benar.`
    );
  }
  await prisma.reservation.delete({ where: { id } });
  realtime.keStaff('reservasi:berubah', { id });
}

// Untuk web publik: apakah meja ini sedang (atau sebentar lagi) dipakai
// reservasi, supaya customer yang datang langsung tahu sebelum memesan.
// Reservasi tidak punya durasi, jadi dipakai perkiraan yang sama dengan
// pencegah double-booking di atas: dianggap berlangsung sampai
// BOOKING_WINDOW_MS setelah jamnya, atau sampai staff menandainya selesai/
// batal. Mulai diberitahukan JEDA_SEBELUM_MS sebelum jamnya, karena meja
// sudah ditahan untuk rombongan itu.
//
// Sengaja cuma jam mulainya yang keluar — nama, nomor HP, dan nama acara
// pemesan tidak boleh terbaca oleh siapa pun yang kebetulan scan QR meja.
const JEDA_SEBELUM_MS = 30 * 60 * 1000;

async function reservasiUntukMejaPublik(tableId, sekarang = new Date()) {
  const reservasi = await prisma.reservation.findFirst({
    where: {
      tableId,
      status: { in: ['pending', 'confirmed'] },
      tanggalReservasi: {
        gte: new Date(sekarang.getTime() - BOOKING_WINDOW_MS),
        lte: new Date(sekarang.getTime() + JEDA_SEBELUM_MS),
      },
    },
    orderBy: { tanggalReservasi: 'desc' },
    select: { tanggalReservasi: true },
  });
  if (!reservasi) return null;
  return {
    waktu: reservasi.tanggalReservasi,
    sudahMulai: reservasi.tanggalReservasi <= sekarang,
  };
}

module.exports = { list, get, create, update, updateStatus, catatPembayaranDp, remove, reservasiUntukMejaPublik };
