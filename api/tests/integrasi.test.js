// Tes integrasi — butuh MySQL hidup dan DIRECT_URL (akun popside_migrate)
// di api/.env. Kalau database tidak bisa dihubungi, seluruh tes di file ini
// dilewati, bukan gagal.
//
// Semua data yang dipakai dibuat sendiri dan dihapus lagi di akhir: meja,
// kategori, produk, akun, shift, dan order sementara (nama berawalan "ZZ
// Uji"). Meja, produk, dan data Anda tidak disentuh. Selama beberapa detik
// tes berjalan ada satu shift uji terbuka, jadi web publik sempat berstatus
// "buka" — jalankan di luar jam operasional.
require('dotenv').config({ quiet: true });
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = require('../src/lib/prisma');
const orderService = require('../src/services/order.service');
const shiftService = require('../src/services/shift.service');
const tableService = require('../src/services/table.service');
const apiKeyService = require('../src/services/apiKey.service');
const customerService = require('../src/services/customer.service');
const cartService = require('../src/services/cart.service');
const reservationService = require('../src/services/reservation.service');
const settingsService = require('../src/services/settings.service');
const orderManagementService = require('../src/services/orderManagement.service');
const bcrypt = require('bcrypt');

const dibuat = {
  orderIds: [],
  userIds: [],
  tableId: null,
  categoryId: null,
  productId: null,
  productIds: [],
  apiKeyIds: [],
  customerIds: [],
  otpHashes: [],
};

const { kolomTelepon, dekripsi, sidikTelepon } = require('../src/utils/kripto');

// Nomor 0800 (bebas pulsa) — tidak mungkin milik member sungguhan.
let urutNomor = 0;
function nomorUji() {
  urutNomor += 1;
  return `0800${String(Date.now()).slice(-6)}${String(urutNomor).padStart(2, '0')}`;
}

// Reservasi uji dibuat tanpa DP. Di bawah aturan DP toko itu = pembebasan,
// yang hanya boleh admin dengan alasan — jadi tes melakukannya sebagai admin,
// supaya tetap jalan apa pun aturan DP toko saat tes dijalankan.
const BEBAS_DP = { depositAmount: 0, alasanDp: 'ZZ uji otomatis' };
const ADMIN_UJI = { id: null, role: 'admin' };

// Jadwal reservasi uji: jauh di masa depan (tahun 2099), jadi tidak mungkin
// bentrok dengan reservasi sungguhan — dan memang di meja uji sendiri.
function jadwalUji(hari, jam = 19) {
  return new Date(Date.UTC(2099, 0, hari, jam - 7, 0, 0));
}
let perawatan = null;
let lewati = null;

function akunTanpaPassword(username) {
  // Hash dari byte acak yang langsung dibuang: akun ini tidak bisa dipakai
  // login oleh siapa pun, cuma jadi ID staff untuk pengujian.
  const acak = crypto.randomBytes(40).toString('base64').replace(/[^A-Za-z0-9./]/g, '').slice(0, 53);
  return prisma.user.create({ data: { username, role: 'kasir', passwordHash: `$2b$12$${acak}` } });
}

test.before(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    lewati = 'database tidak bisa dihubungi';
    return;
  }
  if (!process.env.DIRECT_URL) {
    lewati = 'DIRECT_URL belum diisi — dibutuhkan untuk membersihkan data uji';
    return;
  }
  perawatan = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

  const kasir = await akunTanpaPassword('zz_uji_integrasi');
  dibuat.userIds.push(kasir.id);
  await shiftService.startShift(kasir.id, 0, 'ZZ Uji Integrasi');
  const meja = await tableService.create({ nomorMeja: 'ZZ-UJI', isActive: true, kapasitas: 4 });
  dibuat.tableId = meja.id;
  dibuat.tableToken = meja.qrToken;
  const kategori = await prisma.category.create({ data: { nama: 'ZZ Uji', urutan: 999, isActive: false } });
  dibuat.categoryId = kategori.id;
});

test.after(async () => {
  if (!perawatan) return;
  await perawatan.$transaction(async (tx) => {
    const oid = dibuat.orderIds;
    if (oid.length) {
      await tx.orderStatusLog.deleteMany({ where: { orderId: { in: oid } } });
      await tx.payment.deleteMany({ where: { orderId: { in: oid } } });
      await tx.orderItemVariant.deleteMany({ where: { orderItem: { orderId: { in: oid } } } });
      await tx.orderItem.deleteMany({ where: { orderId: { in: oid } } });
      await tx.order.deleteMany({ where: { id: { in: oid } } });
    }
    const produk = [dibuat.productId, ...dibuat.productIds].filter(Boolean);
    if (produk.length) await tx.product.deleteMany({ where: { id: { in: produk } } });
    if (dibuat.categoryId) await tx.category.deleteMany({ where: { id: dibuat.categoryId } });
    if (dibuat.tableId) {
      await tx.reservationDepositPayment.deleteMany({ where: { reservation: { tableId: dibuat.tableId } } });
      await tx.reservation.deleteMany({ where: { tableId: dibuat.tableId } });
      await tx.table.deleteMany({ where: { id: dibuat.tableId } });
    }
    if (dibuat.apiKeyIds.length) await tx.apiKey.deleteMany({ where: { id: { in: dibuat.apiKeyIds } } });
    if (dibuat.customerIds.length) await tx.customer.deleteMany({ where: { id: { in: dibuat.customerIds } } });
    if (dibuat.otpHashes.length) await tx.memberOtp.deleteMany({ where: { teleponHash: { in: dibuat.otpHashes } } });
    if (dibuat.userIds.length) {
      // Sebelum akunnya dihapus: foreign key akan mengosongkan user_id-nya.
      await tx.auditLog.deleteMany({ where: { userId: { in: dibuat.userIds } } });
      for (const id of dibuat.userIds) {
        await tx.session.deleteMany({ where: { data: { contains: `"user":{"id":${id},` } } });
      }
      await tx.shift.deleteMany({ where: { userId: { in: dibuat.userIds } } });
      await tx.user.deleteMany({ where: { id: { in: dibuat.userIds } } });
    }
  });
  await perawatan.$disconnect();
  await prisma.$disconnect();
});

test('stok: dua pembeli berebut stok terakhir — hanya satu yang lolos', async (t) => {
  if (lewati) return t.skip(lewati);
  const produk = await prisma.product.create({
    data: { categoryId: dibuat.categoryId, nama: 'ZZ Uji Stok Terakhir', harga: 10000, stok: 1, trackStock: true, isAvailable: true },
  });
  dibuat.productId = produk.id;

  const hasil = await Promise.allSettled(
    [1, 2, 3].map(() =>
      orderService.createOrder({ token: dibuat.tableToken, metode: 'tunai', items: [{ productId: produk.id, qty: 1 }] })
    )
  );
  for (const h of hasil) if (h.status === 'fulfilled') dibuat.orderIds.push(h.value.id);
  const lolos = hasil.filter((h) => h.status === 'fulfilled').length;
  const sisa = await prisma.product.findUnique({ where: { id: produk.id }, select: { stok: true } });
  assert.equal(lolos, 1, `yang lolos: ${lolos}`);
  assert.equal(sisa.stok, 0, 'stok tidak boleh minus');
});

test('log aktivitas: akun aplikasi tidak bisa mengubah atau menghapus log', async (t) => {
  if (lewati) return t.skip(lewati);
  assert.ok(dibuat.orderIds.length > 0, 'butuh order dari tes stok');
  // Baris log milik order uji sendiri — sengaja bukan log asli, supaya kalau
  // penjaganya rusak, yang terkena cuma data uji. Menambah log tetap boleh.
  const log = await prisma.orderStatusLog.create({
    data: { orderId: dibuat.orderIds[0], statusFrom: 'pending', statusTo: 'pending', catatan: 'ZZ Uji append-only' },
  });
  await assert.rejects(
    prisma.$executeRaw`UPDATE order_status_log SET catatan = 'diubah' WHERE id = ${log.id}`,
    /append-only/
  );
  await assert.rejects(prisma.$executeRaw`DELETE FROM order_status_log WHERE id = ${log.id}`, /append-only/);
  const masih = await prisma.orderStatusLog.findUnique({ where: { id: log.id } });
  assert.ok(masih, 'baris log tetap ada');
});

test('shift: klik "Mulai Shift" bersamaan tidak membuka dua shift', async (t) => {
  if (lewati) return t.skip(lewati);
  const staff = await akunTanpaPassword('zz_uji_shift_ganda');
  dibuat.userIds.push(staff.id);
  const hasil = await Promise.allSettled([1, 2, 3].map(() => shiftService.startShift(staff.id, 0, 'ZZ Uji Ganda')));
  const lolos = hasil.filter((h) => h.status === 'fulfilled').length;
  const terbuka = await prisma.shift.count({ where: { userId: staff.id, endedAt: null } });
  assert.equal(lolos, 1);
  assert.equal(terbuka, 1);
});

test('shift bersamaan: pesanan & DP masuk ke shift staff yang menerima uangnya, tidak dihitung dua kali', async (t) => {
  if (lewati) return t.skip(lewati);
  const a = await akunTanpaPassword('zz_uji_shift_a');
  const b = await akunTanpaPassword('zz_uji_shift_b');
  dibuat.userIds.push(a.id, b.id);
  await shiftService.startShift(a.id, 100000, 'ZZ Uji Shift A');
  await shiftService.startShift(b.id, 50000, 'ZZ Uji Shift B');

  const produk = await prisma.product.create({
    data: { categoryId: dibuat.categoryId, nama: 'ZZ Uji Shift Bersamaan', harga: 20000, stok: 0, trackStock: false, isAvailable: true },
  });
  dibuat.productIds.push(produk.id);
  const pesan = async () => {
    const o = await orderService.createOrder({ token: dibuat.tableToken, metode: 'tunai', items: [{ productId: produk.id, qty: 1 }] });
    dibuat.orderIds.push(o.id);
    return o;
  };
  const total = async (o) => Number((await prisma.order.findUnique({ where: { id: o.id } })).totalHarga);
  const milikA = await pesan();
  const milikB = await pesan();
  await orderManagementService.confirmPayment(milikA.id, a.id, await total(milikA));
  await orderManagementService.confirmPayment(milikB.id, b.id, await total(milikB));
  // DP tunai diterima staff A.
  await reservationService.create(
    {
      namaCustomer: 'ZZ Uji DP Shift', jumlahTamu: 2, tanggalReservasi: jadwalUji(24), tableId: dibuat.tableId,
      depositAmount: 30000, alasanDp: 'ZZ uji otomatis', dpDibayarSekarang: 30000, metodeDp: 'tunai',
    },
    { id: a.id, role: 'admin' }
  );

  const shiftA = await shiftService.getMyActiveShift(a.id);
  const shiftB = await shiftService.getMyActiveShift(b.id);
  assert.equal(shiftA.orderCount, 1, 'shift A hanya pesanan yang dibayar ke A');
  assert.equal(shiftA.revenue, await total(milikA));
  assert.equal(shiftA.depositTotal, 30000);
  assert.equal(shiftA.expectedCash, 100000 + (await total(milikA)) + 30000);
  assert.equal(shiftB.orderCount, 1, 'shift B hanya pesanan yang dibayar ke B');
  assert.equal(shiftB.revenue, await total(milikB));
  assert.equal(shiftB.depositTotal, 0, 'DP yang diterima A tidak ikut terhitung di B');
  assert.equal(shiftB.expectedCash, 50000 + (await total(milikB)));
});

test('poin member: void dan konfirmasi bersamaan tidak saling menimpa saldo', async (t) => {
  if (lewati) return t.skip(lewati);
  // Nomor 0800 (bebas pulsa) — tidak mungkin milik member sungguhan.
  const member = await prisma.customer.create({
    data: { ...kolomTelepon(nomorUji()), nama: 'ZZ Uji Poin', points: 100 },
  });
  dibuat.customerIds.push(member.id);

  // 10 order dikonfirmasi (+7 poin) dan 10 order di-void (-3 poin) pada
  // saat yang sama, masing-masing dalam transaksinya sendiri.
  await Promise.all([
    ...Array.from({ length: 10 }, () => prisma.$transaction((tx) => customerService.awardPoints(tx, member.id, 7))),
    ...Array.from({ length: 10 }, () => prisma.$transaction((tx) => customerService.reversePoints(tx, member.id, 3))),
  ]);
  const sesudah = await prisma.customer.findUnique({ where: { id: member.id }, select: { points: true } });
  assert.equal(sesudah.points, 100 + 70 - 30);

  await prisma.$transaction((tx) => customerService.reversePoints(tx, member.id, 1000));
  const lantai = await prisma.customer.findUnique({ where: { id: member.id }, select: { points: true } });
  assert.equal(lantai.points, 0, 'saldo tidak pernah minus');
});

test('cek nomor member: hanya dijawab untuk token meja yang sah', async (t) => {
  if (lewati) return t.skip(lewati);
  const items = [{ productId: dibuat.productId, qty: 1 }];
  const nomor = '080000000000'; // 0800 — tidak mungkin milik member sungguhan
  // Token karangan (dan tanpa token) ditolak: kalau dilayani, tiap token
  // karangan jadi jatah rate limit baru dan enumerasi nomor tidak terbatas.
  await assert.rejects(cartService.computeTotal(items, nomor, 'f'.repeat(64)), (err) => err.statusCode === 404);
  await assert.rejects(cartService.computeTotal(items, nomor, undefined), (err) => err.statusCode === 404);
  const sah = await cartService.computeTotal(items, nomor, dibuat.tableToken);
  assert.equal(sah.member, null, 'nomor tidak terdaftar -> member null');
  // Total keranjang biasa (tanpa nomor) tetap jalan tanpa token.
  const biasa = await cartService.computeTotal(items, undefined, undefined);
  assert.equal(biasa.subtotal, sah.subtotal);
});

test('void order lunas: poin member ditarik kembali, PIN salah tidak mengubah apa pun', async (t) => {
  if (lewati) return t.skip(lewati);
  const kasirId = dibuat.userIds[0]; // punya shift uji terbuka (test.before)
  const pin = String(crypto.randomInt(1000, 10000));
  await prisma.user.update({ where: { id: kasirId }, data: { pinHash: await bcrypt.hash(pin, 12) } });

  const produk = await prisma.product.create({
    data: { categoryId: dibuat.categoryId, nama: 'ZZ Uji Void', harga: 20000, stok: 0, trackStock: false, isAvailable: true },
  });
  dibuat.productIds.push(produk.id);
  const member = await prisma.customer.create({
    data: { ...kolomTelepon(nomorUji()), nama: 'ZZ Uji Void', points: 50 },
  });
  dibuat.customerIds.push(member.id);

  const order = await orderService.createOrder({ token: dibuat.tableToken, metode: 'tunai', items: [{ productId: produk.id, qty: 1 }] });
  dibuat.orderIds.push(order.id);
  // Ditautkan ke member dengan 10 poin, lalu dibayar lewat alur kasir asli
  // (confirmPayment) — yang mengkreditkan poinnya.
  await prisma.order.update({ where: { id: order.id }, data: { customerId: member.id, pointsEarned: 10 } });
  const baris = await prisma.order.findUnique({ where: { id: order.id }, select: { totalHarga: true } });
  await orderManagementService.confirmPayment(order.id, kasirId, Number(baris.totalHarga));
  const poin = async () => (await prisma.customer.findUnique({ where: { id: member.id }, select: { points: true } })).points;
  assert.equal(await poin(), 60, 'poin masuk saat dibayar');

  await assert.rejects(
    orderManagementService.updateStatus(order.id, 'cancelled', kasirId, 'ZZ uji void', undefined, pin === '1000' ? '1001' : '1000'),
    (err) => err.statusCode === 403
  );
  assert.equal(await poin(), 60, 'PIN salah: poin tidak berubah');

  await orderManagementService.updateStatus(order.id, 'cancelled', kasirId, 'ZZ uji void', undefined, pin);
  const sesudah = await prisma.order.findUnique({ where: { id: order.id }, select: { status: true } });
  assert.equal(sesudah.status, 'cancelled');
  assert.equal(await poin(), 50, 'poin dari order yang di-void ditarik kembali');
  await assert.rejects(
    orderManagementService.updateStatus(order.id, 'completed', kasirId, 'ZZ uji', undefined, pin),
    (err) => err.statusCode === 409,
    'order yang sudah batal tidak bisa dihidupkan lagi'
  );
});

test('reservasi: tiga staff membooking meja & jam yang sama bersamaan — hanya satu tersimpan', async (t) => {
  if (lewati) return t.skip(lewati);
  const jam = jadwalUji(10);
  const hasil = await Promise.allSettled(
    [1, 2, 3].map((i) =>
      reservationService.create({ namaCustomer: `ZZ Uji Booking ${i}`, jumlahTamu: 2, tanggalReservasi: jam, tableId: dibuat.tableId, ...BEBAS_DP }, ADMIN_UJI)
    )
  );
  assert.equal(hasil.filter((h) => h.status === 'fulfilled').length, 1);
  for (const h of hasil.filter((x) => x.status === 'rejected')) assert.equal(h.reason.statusCode, 409);
});

test('reservasi: menghidupkan lagi reservasi batal yang jadwalnya sudah diambil ditolak', async (t) => {
  if (lewati) return t.skip(lewati);
  const jam = jadwalUji(12);
  const { reservation: lama } = await reservationService.create({
    namaCustomer: 'ZZ Uji Lama', jumlahTamu: 2, tanggalReservasi: jam, tableId: dibuat.tableId, ...BEBAS_DP,
  }, ADMIN_UJI);
  await reservationService.updateStatus(lama.id, 'cancelled');
  await reservationService.create({ namaCustomer: 'ZZ Uji Baru', jumlahTamu: 2, tanggalReservasi: jam, tableId: dibuat.tableId, ...BEBAS_DP }, ADMIN_UJI);
  await assert.rejects(reservationService.updateStatus(lama.id, 'pending'), (err) => err.statusCode === 409);
});

test('reservasi: DP wajib dihitung dari aturan toko di database, bukan dari request', async (t) => {
  if (lewati) return t.skip(lewati);
  const aturan = await settingsService.getAturanDp();
  const { reservation } = await reservationService.create({
    namaCustomer: 'ZZ Uji DP', jumlahTamu: 3, tanggalReservasi: jadwalUji(14), tableId: dibuat.tableId,
  });
  assert.equal(reservation.depositAmount, aturan.perTamu ? aturan.nominal * 3 : aturan.nominal);
});

test('nomor HP member: tidak ada nomor polos di database, tetap bisa dicari', async (t) => {
  if (lewati) return t.skip(lewati);
  const nomor = nomorUji();
  const member = await prisma.$transaction((tx) => customerService.findOrCreateByPhone(tx, nomor, 'ZZ Uji Enkripsi'));
  dibuat.customerIds.push(member.id);

  // Baris mentah dari database: tidak satu kolom pun berisi nomornya.
  const [baris] = await prisma.$queryRaw`SELECT * FROM customers WHERE id = ${member.id}`;
  for (const [kolom, nilai] of Object.entries(baris)) {
    assert.ok(!String(nilai).includes(nomor), `kolom ${kolom} memuat nomor polos`);
  }
  assert.equal(dekripsi(baris.telepon_enc), nomor);
  assert.equal(baris.telepon_hash, sidikTelepon(nomor));

  // Nomor yang sama = member yang sama, bukan member baru.
  const lagi = await prisma.$transaction((tx) => customerService.findOrCreateByPhone(tx, nomor, null));
  assert.equal(lagi.id, member.id);
  // Staff tetap bisa mencari: nomor lengkap, atau 4 digit terakhir.
  assert.ok((await customerService.list(nomor)).some((c) => c.id === member.id && c.telepon === nomor));
  assert.ok((await customerService.list(nomor.slice(-4))).some((c) => c.id === member.id));
});

test('reservasi: nomor HP customer tersimpan terenkripsi', async (t) => {
  if (lewati) return t.skip(lewati);
  const { reservation } = await reservationService.create(
    { namaCustomer: 'ZZ Uji Telepon', telepon: '0812-0000-1234', jumlahTamu: 2, tanggalReservasi: jadwalUji(16), tableId: dibuat.tableId, ...BEBAS_DP },
    ADMIN_UJI
  );
  assert.equal(reservation.telepon, '0812-0000-1234');
  const [baris] = await prisma.$queryRaw`SELECT * FROM reservations WHERE id = ${reservation.id}`;
  assert.ok(!Object.values(baris).some((v) => String(v).includes('0812-0000-1234')), 'nomor polos di database');
});

test('reservasi: DP di bawah aturan toko hanya boleh admin, wajib alasan', async (t) => {
  if (lewati) return t.skip(lewati);
  const aturanAsli = await settingsService.getAturanDp();
  const KASIR = { id: dibuat.userIds[0], role: 'kasir' };
  try {
    await settingsService.updateAturanDp({ nominal: 50000, perTamu: false });
    const dasar = { namaCustomer: 'ZZ Uji Aturan DP', jumlahTamu: 2, tableId: dibuat.tableId };

    await assert.rejects(reservationService.create({ ...dasar, tanggalReservasi: jadwalUji(18), depositAmount: 0 }, KASIR), (e) => e.statusCode === 403);
    await assert.rejects(reservationService.create({ ...dasar, tanggalReservasi: jadwalUji(18), depositAmount: 10000 }, ADMIN_UJI), (e) => e.statusCode === 400);
    const { reservation: dibebaskan } = await reservationService.create(
      { ...dasar, tanggalReservasi: jadwalUji(18), depositAmount: 0, alasanDp: 'ZZ tamu langganan' },
      ADMIN_UJI
    );
    assert.equal(dibebaskan.alasanDp, 'ZZ tamu langganan');
    const { reservation: biasa } = await reservationService.create({ ...dasar, tanggalReservasi: jadwalUji(20) }, KASIR);
    assert.equal(biasa.depositAmount, 50000, 'kasir tanpa isian DP -> ikut aturan toko');

    // Aturan per tamu: menaikkan jumlah tamu sambil membiarkan DP kecil = memotong DP.
    await settingsService.updateAturanDp({ nominal: 20000, perTamu: true });
    const { reservation: kecil } = await reservationService.create({ ...dasar, jumlahTamu: 1, tanggalReservasi: jadwalUji(22) }, KASIR);
    assert.equal(kecil.depositAmount, 20000);
    await assert.rejects(reservationService.update(kecil.id, { jumlahTamu: 4 }, KASIR), (e) => e.statusCode === 403);
    const naik = await reservationService.update(kecil.id, { jumlahTamu: 4, depositAmount: 80000 }, KASIR);
    assert.equal(naik.depositAmount, 80000);
  } finally {
    await settingsService.updateAturanDp(aturanAsli);
  }
});

test('log audit: aksi staff tercatat tanpa rahasia; akun aplikasi tidak bisa mengubah/menghapusnya', async (t) => {
  if (lewati) return t.skip(lewati);
  const express = require('express');
  const { auditLog } = require('../src/middleware/auditLog');
  const staff = { id: dibuat.userIds[0], username: 'zz_uji_integrasi', role: 'kasir' };

  // Middleware asli di depan route tiruan — sama seperti pemasangannya di app.js.
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.get('x-uji-login')) req.session = { user: staff };
    next();
  });
  app.use('/api/admin', auditLog);
  const router = express.Router();
  router.put('/:id', (req, res) => res.json({ ok: true }));
  app.use('/api/admin/zz-uji', router);
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/admin/zz-uji/7`;
  const isi = { nama: 'ZZ', password: 'RahasiaSekali1', pin: '4321', telepon: '081234567890' };
  try {
    await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-uji-login': '1' }, body: JSON.stringify(isi) });
    await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(isi) }); // anonim
  } finally {
    server.close();
  }

  let baris = [];
  for (let i = 0; i < 20 && baris.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 100)); // ditulis sesudah respons terkirim
    baris = await prisma.auditLog.findMany({ where: { aksi: 'PUT /api/admin/zz-uji/:id' } });
  }
  assert.equal(baris.length, 1, 'tercatat tepat sekali — request anonim tidak ikut tercatat');
  const [log] = baris;
  assert.equal(log.userId, staff.id);
  assert.equal(log.status, 200);
  assert.ok(!log.detail.includes('RahasiaSekali1') && !log.detail.includes('4321'), 'password/PIN tidak ikut tercatat');
  const detail = JSON.parse(log.detail);
  assert.equal(detail.params.id, '7');
  assert.equal(detail.body.password, '[disamarkan]');
  assert.equal(detail.body.telepon, '0812******90');

  await assert.rejects(prisma.$executeRaw`UPDATE audit_log SET status = 500 WHERE id = ${log.id}`, /append-only/);
  await assert.rejects(prisma.$executeRaw`DELETE FROM audit_log WHERE id = ${log.id}`, /append-only/);
  assert.ok(await prisma.auditLog.findUnique({ where: { id: log.id } }), 'baris log tetap ada');
});

// Member uji yang saldo poinnya cukup untuk tier terendah (tier sungguhan
// toko dipakai apa adanya; kalau toko belum punya tier, tes OTP dilewati).
async function memberBertier() {
  const tier = await prisma.loyaltyTier.findFirst({ orderBy: { minPoints: 'asc' } });
  if (!tier) return null;
  const nomor = nomorUji();
  const member = await prisma.customer.create({ data: { ...kolomTelepon(nomor), nama: 'ZZ Uji OTP', points: tier.minPoints } });
  dibuat.customerIds.push(member.id);
  dibuat.otpHashes.push(sidikTelepon(nomor));
  return { nomor, member, tier };
}

test('OTP member: kode hanya untuk member bertier, sekali pakai, salah 5x hangus', async (t) => {
  if (lewati) return t.skip(lewati);
  if (!(await settingsService.isMemberEnabled(prisma))) return t.skip('fitur member dimatikan di toko ini');
  const target = await memberBertier();
  if (!target) return t.skip('toko belum punya tier member');
  const memberOtp = require('../src/services/memberOtp.service');
  const { aturPengirimUji } = require('../src/utils/pengirimOtp');
  const terkirim = [];
  aturPengirimUji(async (nomor, kode) => terkirim.push({ nomor, kode }));
  try {
    // Bukan member: tidak ada kode yang dibuat/dikirim.
    const bukanMember = nomorUji();
    dibuat.otpHashes.push(sidikTelepon(bukanMember));
    assert.equal(await memberOtp.prosesMintaKode(bukanMember), null);
    assert.equal(terkirim.length, 0);

    // Jawaban "kirim kode" sama persis untuk member dan bukan member.
    assert.deepEqual(await memberOtp.mintaKode(bukanMember), await memberOtp.mintaKode(target.nomor));
    await new Promise((r) => setTimeout(r, 300)); // pemrosesan berjalan di belakang

    const kode = await memberOtp.prosesMintaKode(target.nomor);
    assert.match(kode, /^\d{6}$/);
    assert.equal(terkirim.at(-1).nomor, target.nomor);
    const baris = await prisma.memberOtp.findFirst({ where: { teleponHash: sidikTelepon(target.nomor), dipakaiAt: null } });
    assert.ok(!JSON.stringify(baris).includes(kode), 'kode tidak disimpan polos');

    const salah = kode === '000000' ? '111111' : '000000';
    await assert.rejects(memberOtp.verifikasiKode(target.nomor, salah), /Sisa 4 percobaan/);
    const tokenCookie = await memberOtp.verifikasiKode(target.nomor, kode);
    assert.equal(memberOtp.sudahTerverifikasi(tokenCookie, target.nomor), true);
    assert.equal(memberOtp.sudahTerverifikasi(tokenCookie, bukanMember), false, 'token hanya untuk nomor itu');
    await assert.rejects(memberOtp.verifikasiKode(target.nomor, kode), /kedaluwarsa/, 'sekali pakai');

    // Kode baru, lalu 5x salah: kode yang benar pun tidak berlaku lagi.
    const kode2 = await memberOtp.prosesMintaKode(target.nomor);
    const salah2 = kode2 === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await assert.rejects(memberOtp.verifikasiKode(target.nomor, salah2));
    await assert.rejects(memberOtp.verifikasiKode(target.nomor, kode2), /kedaluwarsa/);

    // Kedaluwarsa (5 menit) — dimundurkan langsung di database.
    const kode3 = await memberOtp.prosesMintaKode(target.nomor);
    await prisma.memberOtp.updateMany({ where: { teleponHash: sidikTelepon(target.nomor), dipakaiAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await assert.rejects(memberOtp.verifikasiKode(target.nomor, kode3), /kedaluwarsa/);
  } finally {
    aturPengirimUji(null);
  }
});

test('OTP member: tanpa verifikasi tidak ada diskon, detail member, maupun saldo poin', async (t) => {
  if (lewati) return t.skip(lewati);
  if (!(await settingsService.isMemberEnabled(prisma))) return t.skip('fitur member dimatikan di toko ini');
  const target = await memberBertier();
  if (!target) return t.skip('toko belum punya tier member');
  const produk = await prisma.product.create({
    data: { categoryId: dibuat.categoryId, nama: 'ZZ Uji Diskon', harga: 100000, stok: 0, trackStock: false, isAvailable: true },
  });
  dibuat.productIds.push(produk.id);
  const items = [{ productId: produk.id, qty: 1 }];

  const belum = await cartService.computeTotal(items, target.nomor, dibuat.tableToken, { terverifikasi: false });
  assert.equal(belum.discountAmount, 0);
  assert.equal(belum.member, null);
  assert.ok(!belum.nextTier || belum.nextTier.kurangPoin === belum.nextTier.minPoints, 'saldo poin asli tidak terlihat');
  const sudah = await cartService.computeTotal(items, target.nomor, dibuat.tableToken, { terverifikasi: true });
  assert.ok(sudah.discountAmount > 0);
  assert.equal(sudah.member.points, target.tier.minPoints);

  const tanpa = await orderService.createOrder({ token: dibuat.tableToken, metode: 'tunai', items, customerPhone: target.nomor });
  dibuat.orderIds.push(tanpa.id);
  assert.equal(Number(tanpa.discountAmount), 0, 'order tanpa verifikasi: tanpa diskon');
  assert.equal(tanpa.customerId, target.member.id, 'poin tetap untuk pemilik nomor');
  const dengan = await orderService.createOrder(
    { token: dibuat.tableToken, metode: 'tunai', items, customerPhone: target.nomor },
    { memberTerverifikasi: true }
  );
  dibuat.orderIds.push(dengan.id);
  assert.ok(Number(dengan.discountAmount) > 0, 'order terverifikasi: dapat diskon');
});

test('pelacakan order: hanya dari perangkat pemesan (token tersembunyi)', async (t) => {
  if (lewati) return t.skip(lewati);
  const produk = await prisma.product.create({
    data: { categoryId: dibuat.categoryId, nama: 'ZZ Uji Lacak', harga: 15000, stok: 0, trackStock: false, isAvailable: true },
  });
  dibuat.productIds.push(produk.id);
  const perangkatA = crypto.randomBytes(32).toString('hex');
  const perangkatB = crypto.randomBytes(32).toString('hex');
  const kunci = crypto.randomUUID();
  const order = await orderService.createOrder(
    { token: dibuat.tableToken, metode: 'qris', items: [{ productId: produk.id, qty: 1 }], idempotencyKey: kunci },
    { deviceHash: perangkatA }
  );
  dibuat.orderIds.push(order.id);

  assert.equal((await orderService.getByCode(order.kodeOrder, perangkatA)).kodeOrder, order.kodeOrder);
  await assert.rejects(orderService.getByCode(order.kodeOrder, perangkatB), (e) => e.statusCode === 404, 'perangkat lain');
  await assert.rejects(orderService.getByCode(order.kodeOrder, null), (e) => e.statusCode === 404, 'tanpa cookie');
  // Bukti bayar pun hanya dari perangkat pemesan.
  await assert.rejects(orderService.confirmQrisPayment(order.kodeOrder, Buffer.from('x'), perangkatB), (e) => e.statusCode === 404);
  // Kunci idempotensi yang sama dari perangkat lain tidak mengembalikan order ini.
  await assert.rejects(
    orderService.createOrder({ token: dibuat.tableToken, metode: 'qris', items: [{ productId: produk.id, qty: 1 }], idempotencyKey: kunci }, { deviceHash: perangkatB }),
    (e) => e.statusCode === 409
  );
  const ulang = await orderService.createOrder(
    { token: dibuat.tableToken, metode: 'qris', items: [{ productId: produk.id, qty: 1 }], idempotencyKey: kunci },
    { deviceHash: perangkatA }
  );
  assert.equal(ulang.id, order.id, 'percobaan ulang dari perangkat yang sama tetap dapat order yang sama');
});

test('konfirmasi pembayaran: di atas batas wajib PIN staff, di bawahnya tidak', async (t) => {
  if (lewati) return t.skip(lewati);
  const kasirId = dibuat.userIds[0]; // punya shift uji terbuka (test.before)
  const pin = String(crypto.randomInt(1000, 10000));
  await prisma.user.update({ where: { id: kasirId }, data: { pinHash: await bcrypt.hash(pin, 12) } });
  const batasAsli = await settingsService.getPinVerifikasiMinimal();
  try {
    await settingsService.updatePinVerifikasi(100000);
    const buatOrder = async (harga) => {
      const produk = await prisma.product.create({
        data: { categoryId: dibuat.categoryId, nama: `ZZ Uji PIN ${harga}`, harga, stok: 0, trackStock: false, isAvailable: true },
      });
      dibuat.productIds.push(produk.id);
      const o = await orderService.createOrder({ token: dibuat.tableToken, metode: 'tunai', items: [{ productId: produk.id, qty: 1 }] });
      dibuat.orderIds.push(o.id);
      return o;
    };
    const besar = await buatOrder(150000);
    const kecil = await buatOrder(20000);

    const daftar = await orderManagementService.list('pending');
    assert.equal(daftar.find((o) => o.id === besar.id).perluPinKonfirmasi, true);
    assert.equal(daftar.find((o) => o.id === kecil.id).perluPinKonfirmasi, false);

    const total = async (o) => Number((await prisma.order.findUnique({ where: { id: o.id } })).totalHarga);
    await assert.rejects(orderManagementService.confirmPayment(besar.id, kasirId, await total(besar)), (e) => e.statusCode === 403 && e.code === 'PIN_DIPERLUKAN');
    const salah = pin === '1000' ? '1001' : '1000';
    await assert.rejects(orderManagementService.confirmPayment(besar.id, kasirId, await total(besar), salah), (e) => e.code === 'PIN_DIPERLUKAN');
    assert.equal((await prisma.order.findUnique({ where: { id: besar.id } })).status, 'pending', 'tanpa PIN benar: belum lunas');
    const lunas = await orderManagementService.confirmPayment(besar.id, kasirId, await total(besar), pin);
    assert.equal(lunas.status, 'confirmed');
    const kecilLunas = await orderManagementService.confirmPayment(kecil.id, kasirId, await total(kecil));
    assert.equal(kecilLunas.status, 'confirmed', 'order kecil tidak butuh PIN');
  } finally {
    await settingsService.updatePinVerifikasi(batasAsli);
    require('../src/utils/pinAttempts').recordSuccess(kasirId);
  }
});

// App Express yang asli (src/app.js) — session store MySQL, CSRF, cookie,
// rate limit, log audit — dijalankan di proses tes ini, tanpa server dev.
async function jalankanApp() {
  const app = require('../src/app');
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  return { base: `http://127.0.0.1:${server.address().port}/api`, tutup: () => new Promise((r) => server.close(r)) };
}

function klienHttp(base) {
  const jar = {};
  let csrf = null;
  async function kirim(p, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const c = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (c) headers.Cookie = c;
    if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
    const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      jar[pair.slice(0, i)] = pair.slice(i + 1);
    }
    const data = await res.json().catch(() => null);
    if (data?.csrfToken) csrf = data.csrfToken;
    return { status: res.status, body: data };
  }
  return { kirim, siapkan: () => kirim('/auth/csrf-token') };
}

test('2FA admin: wajib dipasang, kode sekali pakai, kode cadangan, sesi tanpa 2FA ditolak', async (t) => {
  if (lewati) return t.skip(lewati);
  const totp = require('../src/utils/totp');
  const sandi = crypto.randomBytes(18).toString('base64url');
  const admin = await prisma.user.create({ data: { username: 'zz_uji_2fa', role: 'admin', passwordHash: await bcrypt.hash(sandi, 12) } });
  dibuat.userIds.push(admin.id);
  const { base, tutup } = await jalankanApp();
  try {
    const a = klienHttp(base);
    await a.siapkan();
    // Password benar -> BELUM login: wajib pasang 2FA dulu.
    const langkah1 = await a.kirim('/auth/login', { method: 'POST', body: { username: 'zz_uji_2fa', password: sandi } });
    assert.deepEqual(langkah1.body, { langkah: 'setup-2fa' });
    assert.equal((await a.kirim('/admin/users')).status, 401, 'belum bisa masuk area admin');
    assert.equal((await a.kirim('/auth/me')).body.user, null);

    const setup = await a.kirim('/auth/2fa/setup', { method: 'POST' });
    assert.equal(setup.status, 200);
    assert.match(setup.body.qrDataUrl, /^data:image\/png;base64,/);
    const rahasia = setup.body.rahasia.replace(/\s/g, '');
    const salah = await a.kirim('/auth/2fa/aktifkan', { method: 'POST', body: { kode: '000000' } });
    assert.equal(salah.status, 400);
    const sekarang = totp.langkahPada();
    const aktif = await a.kirim('/auth/2fa/aktifkan', { method: 'POST', body: { kode: totp.kodePada(totp.base32Decode(rahasia), sekarang) } });
    assert.equal(aktif.status, 200);
    assert.equal(aktif.body.user.username, 'zz_uji_2fa');
    assert.equal(aktif.body.kodePemulihan.length, 8);
    assert.equal((await a.kirim('/admin/users')).status, 200, 'setelah 2FA: masuk');
    const baris = await prisma.user.findUnique({ where: { id: admin.id } });
    assert.ok(baris.totpSecretEnc && !baris.totpSecretEnc.includes(rahasia), 'rahasia TOTP terenkripsi');

    // Login ulang: kode yang barusan dipakai tidak bisa dipakai lagi.
    const b = klienHttp(base);
    await b.siapkan();
    assert.deepEqual((await b.kirim('/auth/login', { method: 'POST', body: { username: 'zz_uji_2fa', password: sandi } })).body, { langkah: 'kode-2fa' });
    const ulangi = await b.kirim('/auth/2fa/verifikasi', { method: 'POST', body: { kode: totp.kodePada(totp.base32Decode(rahasia), sekarang) } });
    assert.equal(ulangi.status, 400, 'kode yang sama ditolak (replay)');
    const berikut = await b.kirim('/auth/2fa/verifikasi', { method: 'POST', body: { kode: totp.kodePada(totp.base32Decode(rahasia), sekarang + 1) } });
    assert.equal(berikut.status, 200);

    // Kode cadangan: sekali pakai.
    const c = klienHttp(base);
    await c.siapkan();
    await c.kirim('/auth/login', { method: 'POST', body: { username: 'zz_uji_2fa', password: sandi } });
    const cadangan = await c.kirim('/auth/2fa/verifikasi', { method: 'POST', body: { kode: aktif.body.kodePemulihan[0] } });
    assert.equal(cadangan.status, 200);
    assert.equal(cadangan.body.sisaKodeCadangan, 7);
    const d = klienHttp(base);
    await d.siapkan();
    await d.kirim('/auth/login', { method: 'POST', body: { username: 'zz_uji_2fa', password: sandi } });
    assert.equal((await d.kirim('/auth/2fa/verifikasi', { method: 'POST', body: { kode: aktif.body.kodePemulihan[0] } })).status, 400);

    // Kasir yang dinaikkan jadi admin di tengah sesi: sesinya langsung tidak berlaku.
    const sandiKasir = crypto.randomBytes(18).toString('base64url');
    const kasir = await prisma.user.create({ data: { username: 'zz_uji_2fa_kasir', role: 'kasir', passwordHash: await bcrypt.hash(sandiKasir, 12) } });
    dibuat.userIds.push(kasir.id);
    const k = klienHttp(base);
    await k.siapkan();
    const loginKasir = await k.kirim('/auth/login', { method: 'POST', body: { username: 'zz_uji_2fa_kasir', password: sandiKasir } });
    assert.equal(loginKasir.body.user.role, 'kasir', 'kasir tanpa 2FA: login biasa');
    assert.equal((await k.kirim('/admin/orders')).status, 200);
    await prisma.user.update({ where: { id: kasir.id }, data: { role: 'admin' } });
    const ditolak = await k.kirim('/admin/orders');
    assert.equal(ditolak.status, 401);
    assert.equal(ditolak.body.code, 'PERLU_2FA');
  } finally {
    await tutup();
  }
});

test('upload mode database: aturan sama, bukti bayar tidak di-cache, kategori tidak bisa ditukar', async (t) => {
  if (lewati) return t.skip(lewati);
  const simpan = process.env.UPLOAD_DRIVER;
  process.env.UPLOAD_DRIVER = 'database';
  const { createImageStore } = require('../src/lib/imageStore');
  const bukti = createImageStore('payment-proof');
  const foto = createImageStore('products');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]);
  function resPalsu() {
    const r = { headers: {}, statusCode: 200, isi: null, req: { headers: {} } };
    r.set = (k, v) => ((r.headers[k.toLowerCase()] = v), r);
    r.status = (s) => ((r.statusCode = s), r);
    r.end = (b) => ((r.isi = b ?? null), r);
    return r;
  }
  let nama = null;
  try {
    await assert.rejects(bukti.save(Buffer.from('bukan gambar')), (e) => e.statusCode === 400);
    nama = await bukti.save(png);
    assert.match(nama, /^[0-9a-f-]{36}\.png$/);
    const r = resPalsu();
    await bukti.kirim(nama, r, (e) => assert.fail(e));
    assert.ok(r.isi.equals(png), 'isi file utuh');
    assert.equal(r.headers['content-type'], 'image/png');
    assert.equal(r.headers['cache-control'], 'private, no-store', 'bukti bayar tidak boleh di-cache');
    // Nama bukti bayar tidak bisa diambil lewat kategori publik (foto menu).
    let galat = null;
    await foto.kirim(nama, resPalsu(), (e) => (galat = e));
    assert.equal(galat?.statusCode, 404);
    await foto.kirim('../../.env', resPalsu(), (e) => (galat = e));
    assert.equal(galat?.statusCode, 404, 'nama di luar pola ditolak');
  } finally {
    if (nama) await bukti.remove(nama);
    process.env.UPLOAD_DRIVER = simpan;
  }
  assert.equal(await prisma.berkasUpload.count({ where: { nama } }), 0, 'terhapus');
});

test('realtime: staff butuh token sah; customer hanya bisa berlangganan order miliknya', async (t) => {
  if (lewati) return t.skip(lewati);
  const http = require('node:http');
  const { io: klien } = require('socket.io-client');
  const app = require('../src/app');
  const realtime = require('../src/realtime');
  const server = http.createServer(app);
  realtime.pasang(server, { originDiizinkan: app.originDiizinkan });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const soket = [];
  const buka = (ns, auth) => {
    const s = klien(`${url}/${ns}`, { path: '/api/realtime', transports: ['websocket'], auth, reconnection: false, forceNew: true });
    soket.push(s);
    return s;
  };
  const tunggu = (s, event, ms = 3000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout ${event}`)), ms);
      s.once(event, (d) => {
        clearTimeout(timer);
        resolve(d);
      });
    });
  try {
    // Tanpa token / token palsu: ditolak.
    await assert.rejects(tunggu(buka('staff', {}), 'connect'), /timeout/);
    const palsu = buka('staff', { token: 'eyJ1IjoxfQ.' + '0'.repeat(64) });
    assert.equal((await tunggu(palsu, 'connect_error')).message, 'unauthorized');

    // Token sah (dari route yang sama ketatnya dengan API) -> terima order baru.
    const staff = buka('staff', { token: realtime.tokenStaff({ id: dibuat.userIds[0] }) });
    await tunggu(staff, 'connect');
    const produk = await prisma.product.create({
      data: { categoryId: dibuat.categoryId, nama: 'ZZ Uji Realtime', harga: 12000, stok: 0, trackStock: false, isAvailable: true },
    });
    dibuat.productIds.push(produk.id);
    const perangkat = crypto.randomBytes(32).toString('hex');
    const menungguBaru = tunggu(staff, 'order:baru');
    const order = await orderService.createOrder(
      { token: dibuat.tableToken, metode: 'tunai', items: [{ productId: produk.id, qty: 1 }] },
      { deviceHash: perangkat }
    );
    dibuat.orderIds.push(order.id);
    assert.equal((await menungguBaru).kodeOrder, order.kodeOrder);

    // Customer: token order dari perangkatnya -> dapat status; soket tanpa
    // token yang benar tidak dapat apa-apa.
    const pemilik = buka('publik');
    const orangLain = buka('publik');
    await Promise.all([tunggu(pemilik, 'connect'), tunggu(orangLain, 'connect')]);
    pemilik.emit('lacak', { token: realtime.tokenOrder(order.id) });
    orangLain.emit('lacak', { token: 'bukan-token' });
    await new Promise((r) => setTimeout(r, 200));
    const menungguStatus = tunggu(pemilik, 'order:status');
    const bocor = tunggu(orangLain, 'order:status', 800).then(() => 'bocor', () => 'aman');
    const totalOrder = Number((await prisma.order.findUnique({ where: { id: order.id } })).totalHarga);
    await orderManagementService.confirmPayment(order.id, dibuat.userIds[0], totalOrder);
    const isiStatus = await menungguStatus;
    assert.equal(isiStatus.status, 'confirmed');
    // Klien mencocokkan kode ini sebelum menerapkan status (satu HP bisa
    // melacak beberapa pesanan).
    assert.equal(isiStatus.kodeOrder, order.kodeOrder);
    assert.equal(await bocor, 'aman', 'soket lain tidak menerima status order orang');
    await assert.rejects(orderService.idMilikPerangkat(order.kodeOrder, crypto.randomBytes(32).toString('hex')), (e) => e.statusCode === 404);
  } finally {
    for (const s of soket) s.close();
    await new Promise((r) => server.close(r));
  }
});

test('realtime: jumlah koneksi dibatasi, origin asing & pesan raksasa ditolak', async (t) => {
  if (lewati) return t.skip(lewati);
  const http = require('node:http');
  const { io: klien } = require('socket.io-client');
  const app = require('../src/app');
  const realtime = require('../src/realtime');
  const server = http.createServer(app);
  realtime.pasang(server, { originDiizinkan: app.originDiizinkan, maksKoneksi: 2 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const soket = [];
  const buka = (opsi = {}) => {
    const s = klien(`${url}/publik`, { path: '/api/realtime', transports: ['websocket'], reconnection: false, forceNew: true, ...opsi });
    soket.push(s);
    return s;
  };
  const hasil = (s) =>
    new Promise((resolve) => {
      s.once('connect', () => resolve('tersambung'));
      s.once('connect_error', () => resolve('ditolak'));
    });
  try {
    assert.equal(await hasil(buka({ extraHeaders: { Origin: 'https://situs-jahat.example' } })), 'ditolak', 'origin asing');
    const a = buka();
    const b = buka();
    assert.deepEqual(await Promise.all([hasil(a), hasil(b)]), ['tersambung', 'tersambung']);
    assert.equal(await hasil(buka()), 'ditolak', 'koneksi ke-3 melewati batas 2');

    // Pesan di atas maxHttpBufferSize (10 KB) memutus koneksi pengirimnya.
    const putus = new Promise((resolve) => a.once('disconnect', resolve));
    a.emit('lacak', { token: 'x'.repeat(20_000) });
    assert.ok(await putus);
    // Slot yang dilepas bisa dipakai koneksi baru lagi.
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await hasil(buka()), 'tersambung');
  } finally {
    for (const s of soket) s.close();
    await new Promise((r) => server.close(r));
  }
});

test('API key: disimpan sebagai hash SHA-256, teks aslinya cuma muncul sekali', async (t) => {
  if (lewati) return t.skip(lewati);
  const baru = await apiKeyService.create('ZZ Uji Integrasi');
  const kunciAsli = baru.rawKey;
  const id = baru.id;
  assert.ok(kunciAsli && id, 'create() mengembalikan rawKey sekali, bersama id');
  dibuat.apiKeyIds.push(id);

  const baris = await prisma.apiKey.findUnique({ where: { id } });
  assert.notEqual(baris.keyHash, kunciAsli);
  assert.equal(baris.keyHash, crypto.createHash('sha256').update(kunciAsli).digest('hex'));
  const daftar = JSON.stringify(await apiKeyService.list());
  assert.ok(!daftar.includes(kunciAsli), 'daftar API key tidak boleh memuat kunci asli');
});

test('IDOR: order dan meja tidak bisa diakses dengan kode/token tebakan', async (t) => {
  if (lewati) return t.skip(lewati);
  await assert.rejects(orderService.getByCode('ORD-20260925-ZZZZ-M1'), (err) => err.statusCode === 404);
  await assert.rejects(orderService.getByCode("ORD-1' OR '1'='1"), (err) => err.statusCode === 404);
  assert.equal(await tableService.verifyToken('a'.repeat(64)), null);
  assert.equal(await tableService.verifyToken(`${dibuat.tableToken}x`), null);
});
