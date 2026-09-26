// Dipakai scripts/siapkan-produksi.js SETELAH process.env.DATABASE_URL
// diarahkan ke database hosting — modul-modul src/ di bawah membaca URL itu
// saat pertama kali dimuat.
const bcrypt = require('bcrypt');
const prisma = require('../../src/lib/prisma');
const tableService = require('../../src/services/table.service');
const { usernameSchema, passwordSchema, pinSchema } = require('../../src/validators/common');
const data = require('../../prisma/data-demo.json');

// Menu, meja, tier, dan info toko dari prisma/data-demo.json — hanya kalau
// database belum punya produk sama sekali (dijalankan ulang = tidak dobel).
async function isiDataDemo() {
  if ((await prisma.product.count()) > 0) return null;

  await prisma.$transaction(async (tx) => {
    for (const b of data.berkas) {
      const isi = Buffer.from(b.isiBase64, 'base64');
      await tx.berkasUpload.upsert({
        where: { nama: b.nama },
        create: { nama: b.nama, kategori: b.kategori, jenis: b.jenis, isi, ukuran: isi.length },
        update: {},
      });
    }
    const idKategori = new Map();
    for (const k of data.kategori) {
      const baru = await tx.category.create({
        data: { nama: k.nama, urutan: k.urutan, isActive: k.isActive, estimasiMenit: k.estimasiMenit },
      });
      idKategori.set(k.kunci, baru.id);
    }
    for (const p of data.produk) {
      await tx.product.create({
        data: {
          categoryId: idKategori.get(p.kategori),
          nama: p.nama,
          harga: p.harga,
          stok: p.stok,
          trackStock: p.trackStock,
          isAvailable: p.isAvailable,
          foto: p.foto,
          variantGroups: {
            create: p.varian.map((g) => ({
              nama: g.nama,
              required: g.required,
              multiple: g.multiple,
              urutan: g.urutan,
              options: { create: g.opsi.map((o) => ({ nama: o.nama, hargaTambahan: o.hargaTambahan, urutan: o.urutan })) },
            })),
          },
        },
      });
    }
    for (const t of data.tier) {
      await tx.loyaltyTier.upsert({ where: { minPoints: t.minPoints }, create: t, update: {} });
    }
    if (data.toko) {
      await tx.storeSetting.upsert({ where: { id: 1 }, create: { id: 1, ...data.toko }, update: data.toko });
    }
  });

  // Meja lewat service-nya sendiri: token QR (HMAC dengan secret unik per
  // meja) dibuat baru di sini — token lokal tidak pernah ikut disalin.
  for (const m of data.meja) {
    if (await prisma.table.findUnique({ where: { nomorMeja: m.nomorMeja } })) continue;
    await tableService.create({ nomorMeja: m.nomorMeja, isActive: m.isActive, kapasitas: m.kapasitas });
  }
  return `${data.kategori.length} kategori, ${data.produk.length} produk, ${data.meja.length} meja, ${data.tier.length} tier member`;
}

async function buatAdminPertama(tanya) {
  if ((await prisma.user.count({ where: { role: 'admin' } })) > 0) {
    console.log('• akun admin sudah ada — dilewati');
    return;
  }
  console.log('\nAkun admin pertama (verifikasi 2 langkah dipasang saat login pertama).');
  const username = usernameSchema.parse(await tanya('Username admin: '));
  const password = passwordSchema.parse(await tanya('Password (disarankan 12+ karakter, tidak tampil): ', { tersembunyi: true }));
  if (password !== (await tanya('Ulangi password: ', { tersembunyi: true }))) {
    throw new Error('Password tidak sama.');
  }
  // PIN dipakai untuk void, pembayaran besar (Pengaturan -> Keamanan
  // Pembayaran), dan reset 2FA akun lain. Boleh dikosongkan, lalu diset
  // nanti di Akun Staff.
  const pinTeks = await tanya('PIN 4-6 digit (kosongkan untuk diset nanti, tidak tampil): ', { tersembunyi: true });
  const pin = pinTeks ? pinSchema.parse(pinTeks) : null;
  if (pin && pin !== (await tanya('Ulangi PIN: ', { tersembunyi: true }))) {
    throw new Error('PIN tidak sama.');
  }
  await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, 12),
      pinHash: pin ? await bcrypt.hash(pin, 12) : null,
      role: 'admin',
    },
  });
  console.log(`✓ akun admin "${username}"${pin ? ' + PIN' : ' (PIN belum diset)'}`);
}

function tutup() {
  return prisma.$disconnect();
}

module.exports = { isiDataDemo, buatAdminPertama, tutup };
