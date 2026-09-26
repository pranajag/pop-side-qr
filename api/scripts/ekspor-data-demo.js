require('dotenv').config({ quiet: true });

// Mengekspor data MENU dari database lokal ke prisma/data-demo.json, untuk
// diisikan ke database hosting oleh scripts/siapkan-produksi.js.
//   npm run ekspor-data-demo
//
// Yang ikut: kategori, produk (+ varian & fotonya), tier member, meja
// (nomor & kapasitas saja — token QR dibuat ulang di hosting), dan info toko
// yang memang tampil ke publik. Yang TIDAK ikut: pesanan, pembayaran, member
// (nomor HP), reservasi, akun staff, shift, log, dan harga modal — file ini
// ikut di-commit ke repo, jadi tidak boleh memuat data pribadi maupun data
// bisnis sensitif.
const fs = require('node:fs');
const path = require('node:path');
const prisma = require('../src/lib/prisma');
const { FILENAME_PATTERN } = require('../src/lib/imageStore');

const UPLOADS = path.resolve(__dirname, '..', 'uploads');
const MIME = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function bacaBerkas(kategori, nama) {
  if (!nama || !FILENAME_PATTERN.test(nama)) return null;
  const file = path.join(UPLOADS, kategori, nama);
  if (path.dirname(file) !== path.join(UPLOADS, kategori) || !fs.existsSync(file)) return null;
  return { nama, kategori, jenis: MIME[path.extname(nama)], isiBase64: fs.readFileSync(file).toString('base64') };
}

async function main() {
  const [kategori, produk, tier, meja, toko] = await Promise.all([
    prisma.category.findMany({ orderBy: { id: 'asc' } }),
    prisma.product.findMany({
      orderBy: { id: 'asc' },
      include: { variantGroups: { orderBy: { urutan: 'asc' }, include: { options: { orderBy: { urutan: 'asc' } } } } },
    }),
    prisma.loyaltyTier.findMany({ orderBy: { minPoints: 'asc' } }),
    prisma.table.findMany({ orderBy: { id: 'asc' } }),
    prisma.storeSetting.findUnique({ where: { id: 1 } }),
  ]);

  const berkas = [];
  const data = {
    versi: 1,
    kategori: kategori.map((k) => ({ kunci: k.id, nama: k.nama, urutan: k.urutan, isActive: k.isActive, estimasiMenit: k.estimasiMenit })),
    produk: produk.map((p) => {
      const foto = bacaBerkas('products', p.foto);
      if (foto) berkas.push(foto);
      return {
        kategori: p.categoryId,
        nama: p.nama,
        harga: Number(p.harga),
        stok: p.stok,
        trackStock: p.trackStock,
        isAvailable: p.isAvailable,
        foto: foto ? p.foto : null,
        varian: p.variantGroups.map((g) => ({
          nama: g.nama,
          required: g.required,
          multiple: g.multiple,
          urutan: g.urutan,
          opsi: g.options.map((o) => ({ nama: o.nama, hargaTambahan: Number(o.hargaTambahan), urutan: o.urutan })),
        })),
      };
    }),
    tier: tier.map((t) => ({ minPoints: t.minPoints, discountPercent: Number(t.discountPercent) })),
    meja: meja.map((m) => ({ nomorMeja: m.nomorMeja, isActive: m.isActive, kapasitas: m.kapasitas })),
    toko: null,
    berkas,
  };
  if (toko) {
    const qris = bacaBerkas('settings', toko.qrisImage);
    if (qris) berkas.push(qris);
    data.toko = {
      namaToko: toko.namaToko,
      alamat: toko.alamat,
      telepon: toko.telepon,
      pajakPersen: Number(toko.pajakPersen),
      serviceChargePersen: Number(toko.serviceChargePersen),
      memberEnabled: toko.memberEnabled,
      reservasiDpNominal: Number(toko.reservasiDpNominal),
      reservasiDpPerTamu: toko.reservasiDpPerTamu,
      pinVerifikasiMinimal: toko.pinVerifikasiMinimal,
      qrisImage: qris ? toko.qrisImage : null,
    };
  }

  const tujuan = path.resolve(__dirname, '..', 'prisma', 'data-demo.json');
  fs.writeFileSync(tujuan, `${JSON.stringify(data, null, 2)}\n`);
  console.log(
    `Tersimpan di prisma/data-demo.json: ${data.kategori.length} kategori, ${data.produk.length} produk, ` +
      `${data.tier.length} tier, ${data.meja.length} meja, ${berkas.length} gambar.`
  );
}

main()
  .catch((err) => {
    console.error(`Gagal: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
