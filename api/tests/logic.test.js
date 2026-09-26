// Tes aturan bisnis — murni, tanpa database. Jalankan: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { canTransition, TRANSITIONS } = require('../src/utils/orderStatus');
const { resolveProductVariants } = require('../src/utils/productVariants');
const { cartTotalSchema } = require('../src/validators/cart.validator');
const { createOrderSchema } = require('../src/validators/order.validator');
const { startShiftSchema, endShiftSchema } = require('../src/validators/shift.validator');
const { memberPhoneSchema } = require('../src/validators/common');
const { jakartaDayBoundsUTC } = require('../src/utils/jakartaTime');
const { generateOrderCode } = require('../src/utils/orderCode');
const { createLoyaltyTierSchema, updateLoyaltyTierSchema } = require('../src/validators/loyaltyTier.validator');
const { catatPembayaranDpSchema } = require('../src/validators/reservation.validator');

test('status order: completed dan cancelled final — order selesai tidak bisa di-void', () => {
  for (const tujuan of Object.keys(TRANSITIONS)) {
    assert.equal(canTransition('completed', tujuan), false, `completed -> ${tujuan}`);
    assert.equal(canTransition('cancelled', tujuan), false, `cancelled -> ${tujuan}`);
  }
});

test('status order: tidak bisa melompat, alur dapur satu langkah', () => {
  assert.equal(canTransition('pending', 'completed'), false);
  assert.equal(canTransition('pending', 'cooking'), false);
  assert.equal(canTransition('waiting_verif', 'cooking'), false);
  assert.equal(canTransition('confirmed', 'ready'), false);
  assert.equal(canTransition('cooking', 'completed'), false);
  for (const [dari, ke] of [
    ['pending', 'waiting_verif'],
    ['pending', 'confirmed'],
    ['waiting_verif', 'confirmed'],
    ['confirmed', 'cooking'],
    ['cooking', 'ready'],
    ['ready', 'completed'],
  ]) {
    assert.equal(canTransition(dari, ke), true, `${dari} -> ${ke}`);
  }
});

test('status order: status tak dikenal selalu ditolak', () => {
  assert.equal(canTransition('void', 'completed'), false);
  assert.equal(canTransition('pending', 'void'), false);
  assert.equal(canTransition('__proto__', 'cancelled'), false);
});

test('varian silang: pilihan varian milik produk lain ditolak', () => {
  const ayam = {
    nama: 'Ayam Geprek',
    variantGroups: [{ nama: 'Level', required: false, multiple: false, options: [{ id: 1, nama: 'Pedas', hargaTambahan: 0 }] }],
  };
  const idVarianWagyu = 99;
  const hasil = resolveProductVariants(ayam, [idVarianWagyu]);
  assert.match(hasil.error, /tidak valid/);

  const sah = resolveProductVariants(ayam, [1]);
  assert.equal(sah.error, null);
  assert.equal(sah.extraPerUnit, 0);
});

// Semua schema request strict: field yang tidak dikenal DITOLAK (400),
// bukan dibuang diam-diam — harga/total/diskon kiriman browser tidak pernah
// sampai ke kode yang menghitung.
function fieldDitolak(hasil) {
  assert.equal(hasil.success, false);
  return hasil.error.issues.filter((i) => i.code === 'unrecognized_keys').flatMap((i) => i.keys);
}

test('keranjang: harga/total kiriman browser ditolak, server yang menghitung', () => {
  const ditolak = fieldDitolak(
    cartTotalSchema.safeParse({
      items: [{ productId: 1, qty: 2, harga: 1, price: 1, subtotal: 2 }],
      total: 2,
      discountAmount: 999999,
    })
  );
  for (const k of ['harga', 'price', 'subtotal', 'total', 'discountAmount']) assert.ok(ditolak.includes(k), k);
  const sah = cartTotalSchema.parse({ items: [{ productId: 1, qty: 2 }] });
  assert.deepEqual(Object.keys(sah.items[0]).sort(), ['productId', 'qty']);
});

test('order publik: field terlarang (status, total, poin) ditolak', () => {
  const ditolak = fieldDitolak(
    createOrderSchema.safeParse({
      token: 'a'.repeat(64),
      metode: 'qris',
      items: [{ productId: 1, qty: 1 }],
      status: 'completed',
      totalHarga: 1,
      pointsEarned: 999,
    })
  );
  assert.deepEqual(ditolak.sort(), ['pointsEarned', 'status', 'totalHarga']);
});

test('validasi strict: setiap schema request menolak field yang tidak dikenal', () => {
  const folder = path.join(__dirname, '..', 'src', 'validators');
  for (const f of fs.readdirSync(folder)) {
    const sumber = fs.readFileSync(path.join(folder, f), 'utf8');
    assert.doesNotMatch(sumber, /z\s*\.\s*object\(|\.passthrough\(|\.loose\(/, `${f} memakai objek non-strict`);
  }
  const params = fs.readFileSync(path.join(__dirname, '..', 'src', 'middleware', 'validateParams.js'), 'utf8');
  assert.doesNotMatch(params, /z\.object\(/);
});

test('order publik: jumlah item harus bilangan bulat positif', () => {
  for (const qty of [0, -1, 1.5]) {
    const r = createOrderSchema.safeParse({ token: 'a'.repeat(64), metode: 'tunai', items: [{ productId: 1, qty }] });
    assert.equal(r.success, false, `qty ${qty}`);
  }
});

test('uang: tidak ada kolom Float di skema — semua nominal Decimal', () => {
  const skema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  assert.doesNotMatch(skema, /\bFloat\b/);
});

test('diskon tier: di atas 25% ditolak server, termasuk lewat edit', () => {
  for (const persen of [26, 90, 100]) {
    assert.equal(createLoyaltyTierSchema.safeParse({ minPoints: 100, discountPercent: persen }).success, false, `${persen}%`);
    assert.equal(updateLoyaltyTierSchema.safeParse({ discountPercent: persen }).success, false, `edit ${persen}%`);
  }
  assert.equal(createLoyaltyTierSchema.safeParse({ minPoints: 100, discountPercent: 25 }).success, true);
});

test('DP reservasi: cicilan 0 atau minus ditolak', () => {
  for (const amount of [0, -1000]) {
    assert.equal(catatPembayaranDpSchema.safeParse({ amount, metode: 'tunai' }).success, false, `amount ${amount}`);
  }
  assert.equal(catatPembayaranDpSchema.safeParse({ amount: 50000, metode: 'bitcoin' }).success, false, 'metode di luar daftar');
});

test('kas shift: nominal minus ditolak', () => {
  assert.equal(startShiftSchema.safeParse({ cashStart: -1, namaStaff: 'x' }).success, false);
  assert.equal(endShiftSchema.safeParse({ cashCounted: -500 }).success, false);
  assert.equal(endShiftSchema.safeParse({ cashCounted: 1000, gojekAmount: -1 }).success, false);
});

test('laporan: batas hari mengikuti WIB, disimpan sebagai UTC', () => {
  const { start, end } = jakartaDayBoundsUTC('2026-09-25');
  assert.equal(start.toISOString(), '2026-09-24T17:00:00.000Z');
  assert.equal(end.toISOString(), '2026-09-25T17:00:00.000Z');
  assert.equal(jakartaDayBoundsUTC('2026-02-30'), null);
});

test('member: nomor HP dibakukan, format lain tetap member yang sama', () => {
  for (const ketik of ['081234567890', '0812 3456 7890', '+62 812-3456-7890', '81234567890']) {
    assert.equal(memberPhoneSchema.parse(ketik), '081234567890', ketik);
  }
  assert.equal(memberPhoneSchema.safeParse('0812abc').success, false);
});

test('kode order: akhiran meja dan -TA untuk pesanan tanpa meja', () => {
  assert.match(generateOrderCode('1'), /^ORD-\d{8}-[A-HJ-NP-Z2-9]{4}-M1$/);
  assert.match(generateOrderCode(null), /^ORD-\d{8}-[A-HJ-NP-Z2-9]{4}-TA$/);
});

test('polling status order: jeda >= 10 detik dan berhenti saat tab tersembunyi', () => {
  const sumber = fs.readFileSync(path.join(__dirname, '..', '..', 'public-web', 'src', 'views', 'OrderView.vue'), 'utf8');
  const jeda = [...sumber.matchAll(/statusTimer = setInterval\([\s\S]*?\}, (\d+)\)/g)].map((m) => Number(m[1]));
  assert.ok(jeda.length > 0, 'interval polling tidak ditemukan');
  assert.ok(jeda.every((ms) => ms >= 10000), `jeda polling: ${jeda}`);
  assert.match(sumber, /document\.visibilityState === 'hidden'/);
});
