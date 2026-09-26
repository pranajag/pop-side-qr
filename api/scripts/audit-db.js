// Pemeriksa kesehatan data — BACA SAJA, tidak pernah mengubah apa pun.
// Jalankan kapan saja dengan: npm run db:audit
//
// Yang dicek: referensi antar tabel yang putus, total order yang tidak
// cocok dengan itemnya, pembayaran yang tidak sinkron, poin member yang
// melenceng, nomor HP terenkripsi yang tidak cocok dengan kunci di .env,
// penanda meja yang nyangkut, order/shift yang tidak pernah ditutup, stok
// minus, dan format kode order.
require('dotenv').config({ quiet: true });
const prisma = require('../src/lib/prisma');
const { dekripsi, sidikTelepon } = require('../src/utils/kripto');
const p = prisma;

const temuan = [];
function lapor(berat, judul, detail) {
  temuan.push({ berat, judul, detail });
}

async function sql(q) {
  return p.$queryRawUnsafe(q);
}

(async () => {
  // ---------- 1. Baris yatim (FK putus) ----------
  const yatim = [
    ['order_items -> orders', 'SELECT oi.id FROM order_items oi LEFT JOIN orders o ON o.id=oi.order_id WHERE o.id IS NULL'],
    ['order_item_variants -> order_items', 'SELECT v.id FROM order_item_variants v LEFT JOIN order_items oi ON oi.id=v.order_item_id WHERE oi.id IS NULL'],
    ['order_status_log -> orders', 'SELECT l.id FROM order_status_log l LEFT JOIN orders o ON o.id=l.order_id WHERE o.id IS NULL'],
    ['payments -> orders', 'SELECT pm.id FROM payments pm LEFT JOIN orders o ON o.id=pm.order_id WHERE o.id IS NULL'],
    ['products -> categories', 'SELECT pr.id FROM products pr LEFT JOIN categories c ON c.id=pr.category_id WHERE c.id IS NULL'],
    ['variant_groups -> products', 'SELECT g.id FROM variant_groups g LEFT JOIN products pr ON pr.id=g.product_id WHERE pr.id IS NULL'],
    ['variant_options -> variant_groups', 'SELECT vo.id FROM variant_options vo LEFT JOIN variant_groups g ON g.id=vo.group_id WHERE g.id IS NULL'],
    ['orders -> tables', 'SELECT o.id FROM orders o LEFT JOIN tables t ON t.id=o.table_id WHERE o.table_id IS NOT NULL AND t.id IS NULL'],
    ['orders -> customers', 'SELECT o.id FROM orders o LEFT JOIN customers cu ON cu.id=o.customer_id WHERE o.customer_id IS NOT NULL AND cu.id IS NULL'],
    ['order_items -> products', 'SELECT oi.id FROM order_items oi LEFT JOIN products pr ON pr.id=oi.product_id WHERE pr.id IS NULL'],
    ['staff_calls -> tables', 'SELECT s.id FROM staff_calls s LEFT JOIN tables t ON t.id=s.table_id WHERE t.id IS NULL'],
    ['reservations -> tables', 'SELECT r.id FROM reservations r LEFT JOIN tables t ON t.id=r.table_id WHERE r.table_id IS NOT NULL AND t.id IS NULL'],
    ['shifts -> users', 'SELECT sh.id FROM shifts sh LEFT JOIN users u ON u.id=sh.user_id WHERE u.id IS NULL'],
    ['payments -> users (verified_by)', 'SELECT pm.id FROM payments pm LEFT JOIN users u ON u.id=pm.verified_by WHERE pm.verified_by IS NOT NULL AND u.id IS NULL'],
    ['order_status_log -> users (changed_by)', 'SELECT l.id FROM order_status_log l LEFT JOIN users u ON u.id=l.changed_by WHERE l.changed_by IS NOT NULL AND u.id IS NULL'],
  ];
  for (const [nama, q] of yatim) {
    const r = await sql(q);
    if (r.length) lapor('KRITIS', `Baris yatim: ${nama}`, `${r.length} baris, id: ${r.slice(0, 10).map((x) => x.id).join(', ')}`);
  }

  // ---------- 2. Order tanpa item ----------
  const tanpaItem = await sql(
    'SELECT o.id, o.kode_order, o.status, o.total_harga FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id WHERE oi.id IS NULL'
  );
  if (tanpaItem.length) lapor('KRITIS', 'Order tanpa item sama sekali', JSON.stringify(tanpaItem));

  // ---------- 3. Total order tidak cocok dengan itemnya ----------
  const semuaOrder = await sql(`
    SELECT o.id, o.kode_order, o.status, o.total_harga, o.discount_amount, o.tax_amount, o.service_charge_amount,
           COALESCE(SUM(oi.harga_saat_order * oi.qty), 0) AS subtotal_item,
           COALESCE((SELECT SUM(v.harga_tambahan * oi2.qty) FROM order_item_variants v
                     JOIN order_items oi2 ON oi2.id = v.order_item_id WHERE oi2.order_id = o.id), 0) AS subtotal_varian
    FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
    GROUP BY o.id`);
  const selisih = semuaOrder
    .map((o) => {
      const harusnya =
        Number(o.subtotal_item) + Number(o.subtotal_varian) - Number(o.discount_amount ?? 0) +
        Number(o.tax_amount ?? 0) + Number(o.service_charge_amount ?? 0);
      return { ...o, harusnya, beda: Number(o.total_harga) - harusnya };
    })
    .filter((o) => Math.abs(o.beda) > 1);
  if (selisih.length)
    lapor('KRITIS', 'Total order tidak sama dengan hitungan itemnya',
      selisih.map((o) => `${o.kode_order}: tersimpan ${o.total_harga}, harusnya ${o.harusnya} (beda ${o.beda})`).join(' | '));

  // ---------- 4. Pembayaran ----------
  const bayarBeda = await sql(
    'SELECT o.kode_order, o.total_harga, pm.amount FROM payments pm JOIN orders o ON o.id=pm.order_id WHERE ABS(pm.amount - o.total_harga) > 1'
  );
  if (bayarBeda.length) lapor('KRITIS', 'Nominal payment beda dengan total order', JSON.stringify(bayarBeda));

  const metodeBeda = await sql(
    'SELECT o.kode_order, o.metode AS metode_order, pm.metode AS metode_payment FROM payments pm JOIN orders o ON o.id=pm.order_id WHERE pm.metode <> o.metode'
  );
  if (metodeBeda.length) lapor('SEDANG', 'Metode payment beda dengan metode order', JSON.stringify(metodeBeda));

  const selesaiTanpaBayar = await sql(
    "SELECT o.id, o.kode_order, o.status, o.metode, o.total_harga, o.created_at FROM orders o LEFT JOIN payments pm ON pm.order_id=o.id WHERE o.status='completed' AND pm.id IS NULL"
  );
  if (selesaiTanpaBayar.length)
    lapor('KRITIS', 'Order completed tapi tidak punya baris payment', JSON.stringify(selesaiTanpaBayar));

  const batalTapiBayar = await sql(
    "SELECT o.kode_order, o.status, pm.amount FROM payments pm JOIN orders o ON o.id=pm.order_id WHERE o.status='cancelled'"
  );
  if (batalTapiBayar.length) lapor('SEDANG', 'Order cancelled tapi punya payment', JSON.stringify(batalTapiBayar));

  // ---------- 5. Poin member ----------
  const poinTanpaCustomer = await sql(
    'SELECT kode_order, points_earned FROM orders WHERE points_earned > 0 AND customer_id IS NULL'
  );
  if (poinTanpaCustomer.length) lapor('SEDANG', 'Order punya points_earned tapi tanpa customer', JSON.stringify(poinTanpaCustomer));

  // Poin baru masuk saldo saat pembayaran dikonfirmasi (confirmPayment),
  // atau langsung untuk pesanan manual yang lahir berstatus confirmed. Order
  // pending/waiting_verif sudah mencatat pointsEarned tapi BELUM dikreditkan,
  // jadi tidak boleh ikut dijumlah — kalau ikut, audit menuduh selisih yang
  // sebenarnya cuma pembayaran yang belum dikonfirmasi.
  const poinCustomer = await sql(`
    SELECT cu.id, cu.telepon_akhir, cu.points AS poin_tersimpan,
           COALESCE(SUM(CASE WHEN o.status IN ('confirmed','cooking','ready','completed') THEN o.points_earned ELSE 0 END), 0) AS poin_dari_order
    FROM customers cu LEFT JOIN orders o ON o.customer_id = cu.id GROUP BY cu.id`);
  const poinBeda = poinCustomer.filter((c) => Number(c.poin_tersimpan) !== Number(c.poin_dari_order));
  if (poinBeda.length)
    lapor('SEDANG', 'Poin customer tidak cocok dengan akumulasi order',
      poinBeda.map((c) => `member #${c.id} (…${c.telepon_akhir}): tersimpan ${c.poin_tersimpan}, dari order ${c.poin_dari_order}`).join(' | '));

  // ---------- 5b. Nomor HP terenkripsi ----------
  // Setiap nomor harus bisa dibuka dengan DATA_ENC_KEY yang sekarang, dan
  // sidiknya harus cocok dengan DATA_HASH_KEY yang sekarang. Gagal di sini
  // hampir selalu berarti kunci di .env tertukar/berganti — data belum
  // rusak, tapi JANGAN tambah data baru sebelum kunci yang benar kembali.
  // Nomornya sendiri tidak pernah dicetak.
  const kunciBermasalah = [];
  for (const m of await p.customer.findMany({ select: { id: true, teleponEnc: true, teleponHash: true, teleponAkhir: true } })) {
    try {
      const nomor = dekripsi(m.teleponEnc);
      if (sidikTelepon(nomor) !== m.teleponHash || nomor.slice(-4) !== m.teleponAkhir) kunciBermasalah.push(`member #${m.id} (sidik tidak cocok)`);
    } catch {
      kunciBermasalah.push(`member #${m.id} (tidak bisa dibuka)`);
    }
  }
  for (const r of await p.reservation.findMany({ where: { teleponEnc: { not: null } }, select: { id: true, teleponEnc: true } })) {
    try {
      dekripsi(r.teleponEnc);
    } catch {
      kunciBermasalah.push(`reservasi #${r.id} (tidak bisa dibuka)`);
    }
  }
  if (kunciBermasalah.length)
    lapor('TINGGI', 'Nomor HP terenkripsi tidak cocok dengan kunci di .env (DATA_ENC_KEY/DATA_HASH_KEY)', kunciBermasalah.join(' | '));

  // ---------- 6. Status meja ----------
  // Daftar status aktif ditulis langsung di teks SQL-nya, bukan disisipkan
  // lewat ${} — AGENTS.md melarang interpolasi string ke raw SQL dalam
  // bentuk apa pun, konstanta sekalipun.
  const meja = await sql(`
    SELECT t.id, t.nomor_meja, t.is_bill_open, t.current_visit_started_at, t.is_active,
           (SELECT COUNT(*) FROM orders o WHERE o.table_id=t.id AND o.status IN ('pending','waiting_verif','confirmed','cooking','ready')) AS order_aktif
    FROM tables t`);
  const billSalah = meja.filter((t) => t.is_bill_open && Number(t.order_aktif) === 0);
  if (billSalah.length)
    lapor('SEDANG', 'Meja ditandai bill terbuka padahal tidak ada order aktif',
      billSalah.map((t) => `meja ${t.nomor_meja}`).join(', '));

  const visitMasaDepan = meja.filter(
    (t) => t.current_visit_started_at && new Date(t.current_visit_started_at) > new Date()
  );
  if (visitMasaDepan.length)
    lapor('SEDANG', 'current_visit_started_at di masa depan', visitMasaDepan.map((t) => `meja ${t.nomor_meja}`).join(', '));

  // ---------- 7. Order nyangkut / shift / staff call ----------
  const orderNyangkut = await sql(`
    SELECT id, kode_order, status, table_id, created_at FROM orders
    WHERE status IN ('pending','waiting_verif','confirmed','cooking','ready') AND created_at < DATE_SUB(NOW(), INTERVAL 12 HOUR) ORDER BY created_at`);
  if (orderNyangkut.length)
    lapor('SEDANG', 'Order belum selesai/batal padahal sudah lewat 12 jam',
      orderNyangkut.map((o) => `${o.kode_order} (${o.status}, ${new Date(o.created_at).toLocaleString('id-ID')})`).join(' | '));

  const shiftNyangkut = await sql(
    'SELECT id, user_id, nama_staff, started_at FROM shifts WHERE ended_at IS NULL ORDER BY started_at'
  );
  if (shiftNyangkut.length)
    lapor('SEDANG', 'Shift masih terbuka',
      shiftNyangkut.map((s) => `#${s.id} ${s.nama_staff ?? ''} mulai ${new Date(s.started_at).toLocaleString('id-ID')}`).join(' | '));

  const panggilanNyangkut = await sql(
    "SELECT id, table_id, created_at FROM staff_calls WHERE status='pending' AND created_at < DATE_SUB(NOW(), INTERVAL 6 HOUR)"
  );
  if (panggilanNyangkut.length)
    lapor('RINGAN', 'Panggilan staff pending sudah basi (>6 jam)', `${panggilanNyangkut.length} baris`);

  // ---------- 7b. DP reservasi ----------
  // Ringkasan lunas di baris reservasi harus sama dengan jumlah pembayaran
  // DP-nya, dan tidak boleh ada DP yang terbayar melebihi DP wajib.
  const dpReservasi = await sql(`
    SELECT r.id, r.nama_customer, r.deposit_amount, r.deposit_paid, r.status,
           COALESCE(SUM(pb.amount), 0) AS dibayar
    FROM reservations r LEFT JOIN reservation_deposit_payments pb ON pb.reservation_id = r.id
    GROUP BY r.id`);
  const dpTidakSinkron = dpReservasi.filter((r) => {
    const wajib = Number(r.deposit_amount ?? 0);
    const seharusnyaLunas = wajib > 0 && Number(r.dibayar) >= wajib;
    return Boolean(r.deposit_paid) !== seharusnyaLunas;
  });
  if (dpTidakSinkron.length)
    lapor('SEDANG', 'Status lunas DP tidak cocok dengan jumlah pembayarannya',
      dpTidakSinkron.map((r) => `#${r.id} ${r.nama_customer}: wajib ${r.deposit_amount}, dibayar ${r.dibayar}, lunas=${r.deposit_paid}`).join(' | '));
  const dpLebih = dpReservasi.filter((r) => Number(r.dibayar) > Number(r.deposit_amount ?? 0));
  if (dpLebih.length)
    lapor('SEDANG', 'DP terbayar melebihi DP wajib',
      dpLebih.map((r) => `#${r.id} ${r.nama_customer}: wajib ${r.deposit_amount}, dibayar ${r.dibayar}`).join(' | '));
  const yatimDp = await sql('SELECT pb.id FROM reservation_deposit_payments pb LEFT JOIN reservations r ON r.id = pb.reservation_id WHERE r.id IS NULL');
  if (yatimDp.length) lapor('KRITIS', 'Pembayaran DP tanpa reservasi', `${yatimDp.length} baris`);

  // ---------- 8. Produk & stok ----------
  const stokMinus = await sql('SELECT id, nama, stok FROM products WHERE stok < 0');
  if (stokMinus.length) lapor('KRITIS', 'Stok produk minus', JSON.stringify(stokMinus));

  const stokHabisTapiTersedia = await sql(
    'SELECT id, nama, stok FROM products WHERE track_stock = 1 AND stok <= 0 AND is_available = 1'
  );
  if (stokHabisTapiTersedia.length)
    lapor('RINGAN', 'Produk stok habis tapi masih ditandai tersedia', JSON.stringify(stokHabisTapiTersedia));

  const hargaAneh = await sql('SELECT id, nama, harga, harga_modal FROM products WHERE harga <= 0 OR (harga_modal IS NOT NULL AND harga_modal > harga)');
  if (hargaAneh.length) lapor('SEDANG', 'Harga produk nol/negatif atau modal > harga jual', JSON.stringify(hargaAneh));

  const grupVarianKosong = await sql('SELECT g.id, g.nama, g.product_id FROM variant_groups g LEFT JOIN variant_options vo ON vo.group_id=g.id WHERE vo.id IS NULL');
  if (grupVarianKosong.length) lapor('SEDANG', 'Grup varian tanpa satu pun opsi', JSON.stringify(grupVarianKosong));

  const kategoriKosong = await sql('SELECT c.id, c.nama FROM categories c LEFT JOIN products pr ON pr.category_id=c.id WHERE pr.id IS NULL');
  if (kategoriKosong.length) lapor('RINGAN', 'Kategori tanpa produk', JSON.stringify(kategoriKosong));

  // ---------- 9. Pengaturan & tier ----------
  const setting = await sql('SELECT id FROM store_settings');
  if (setting.length !== 1 || setting[0].id !== 1)
    lapor('SEDANG', 'store_settings harus tepat 1 baris dengan id=1', JSON.stringify(setting.map((s) => s.id)));

  const tier = await sql('SELECT id, min_points, discount_percent FROM loyalty_tiers ORDER BY min_points');
  const tierAneh = tier.filter((t) => Number(t.discount_percent) <= 0 || Number(t.discount_percent) > 100 || Number(t.min_points) < 0);
  if (tierAneh.length) lapor('SEDANG', 'Loyalty tier di luar nalar', JSON.stringify(tierAneh));

  // ---------- 10. User ----------
  const userSemua = await sql('SELECT id, username, role, is_active FROM users');
  if (!userSemua.some((u) => u.role === 'admin' && u.is_active))
    lapor('KRITIS', 'Tidak ada user admin yang aktif', JSON.stringify(userSemua));

  // ---------- 11. Format kode order ----------
  const kodeSalah = await sql("SELECT id, kode_order FROM orders WHERE kode_order NOT REGEXP '^ORD-[0-9]{8}-[A-Z0-9]{4}(-(M[A-Z0-9]{1,4}|TA))?$'");
  if (kodeSalah.length) lapor('SEDANG', 'Kode order tidak sesuai format ORD-YYYYMMDD-XXXX(-M<meja>|-TA)', JSON.stringify(kodeSalah));

  // ---------- 12. Ringkasan isi tabel ----------
  // Lewat model Prisma, bukan SQL — nama tabel tidak bisa jadi parameter,
  // dan menyisipkannya ke teks query dilarang AGENTS.md.
  const MODEL = {
    tables: 'table', categories: 'category', products: 'product', variant_groups: 'variantGroup',
    variant_options: 'variantOption', orders: 'order', order_items: 'orderItem',
    order_item_variants: 'orderItemVariant', order_status_log: 'orderStatusLog', payments: 'payment',
    customers: 'customer', loyalty_tiers: 'loyaltyTier', shifts: 'shift', staff_calls: 'staffCall',
    reservations: 'reservation', users: 'user', store_settings: 'storeSetting', api_keys: 'apiKey',
    webhooks: 'webhook',
    reservation_deposit_payments: 'reservationDepositPayment',
  };
  const ringkas = {};
  for (const [tabel, model] of Object.entries(MODEL)) ringkas[tabel] = await p[model].count();

  console.log('=== ISI TABEL ===');
  console.log(JSON.stringify(ringkas));
  console.log('\n=== TEMUAN (' + temuan.length + ') ===');
  for (const t of temuan) console.log(`[${t.berat}] ${t.judul}\n    ${t.detail}\n`);
  if (!temuan.length) console.log('Bersih — tidak ada masalah ditemukan.');
  await p.$disconnect();
  process.exitCode = temuan.some((t) => t.berat === 'KRITIS') ? 1 : 0;
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
