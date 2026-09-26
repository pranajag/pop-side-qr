const crypto = require('node:crypto');
const QRCode = require('qrcode');
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const totp = require('../utils/totp');
const { enkripsi, dekripsi, sidik } = require('../utils/kripto');
const { buatPenghitung } = require('../utils/penghitungGagal');

// 2FA TOTP. WAJIB untuk admin (akun yang bisa mengubah harga, akun staff,
// pengaturan) — admin yang belum punya 2FA dipaksa memasangnya di login
// berikutnya. Kasir boleh memakainya juga; begitu aktif, ikut diwajibkan.
//
// Rahasia TOTP disimpan terenkripsi (kripto.js). Kode yang sudah dipakai
// tidak bisa dipakai lagi (users.totp_langkah_terakhir). 5x salah dalam 15
// menit -> akun itu tidak bisa mencoba 2FA selama 15 menit.
const PENERBIT = 'Popside';
const JUMLAH_KODE_PEMULIHAN = 8;
const percobaan = buatPenghitung({ maks: 5, jendelaMs: 15 * 60 * 1000, kunciMs: 15 * 60 * 1000 });

function wajib2fa(user) {
  return user.role === 'admin' || Boolean(user.totpAktifSejak);
}

async function mulaiSetup(username) {
  const rahasia = totp.buatRahasia();
  const url = totp.otpauthUrl({ rahasia, akun: username, penerbit: PENERBIT });
  return {
    rahasiaEnc: enkripsi(rahasia),
    tampil: {
      // Untuk diketik manual kalau QR tidak bisa di-scan — dikelompokkan 4
      // huruf supaya mudah dibaca.
      rahasia: rahasia.match(/.{1,4}/g).join(' '),
      otpauthUrl: url,
      qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 240 }),
    },
  };
}

// Kode cadangan: 8 karakter dari alfabet tanpa huruf/angka yang mirip
// (0/O, 1/I/L), ditulis XXXX-XXXX. Hanya sidiknya yang disimpan.
const ALFABET_PEMULIHAN = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function kodePemulihanBaru() {
  let kode = '';
  for (let i = 0; i < 8; i++) kode += ALFABET_PEMULIHAN[crypto.randomInt(0, ALFABET_PEMULIHAN.length)];
  return `${kode.slice(0, 4)}-${kode.slice(4)}`;
}
function normalKodePemulihan(kode) {
  return String(kode).toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function sidikPemulihan(userId, kode) {
  return sidik('pemulihan-2fa', `${userId}:${normalKodePemulihan(kode)}`);
}

async function buatKodePemulihan(tx, userId) {
  await tx.kodePemulihan.deleteMany({ where: { userId } });
  const kode = Array.from({ length: JUMLAH_KODE_PEMULIHAN }, kodePemulihanBaru);
  await tx.kodePemulihan.createMany({ data: kode.map((k) => ({ userId, kodeHash: sidikPemulihan(userId, k) })) });
  return kode;
}

function periksaKunci(userId) {
  if (percobaan.isLocked(userId)) {
    throw new AppError(429, 'Terlalu banyak kode 2FA salah. Coba lagi 15 menit lagi.');
  }
}

function catatGagal(userId) {
  const terkunci = percobaan.recordFailure(userId);
  logger.warn({ userId, terkunci }, terkunci ? 'Kode 2FA salah 5x — dikunci 15 menit' : 'Kode 2FA salah');
}

// Setup: kode pertama dari aplikasi authenticator membuktikan QR-nya sudah
// ter-scan dengan benar. Baru setelah itu 2FA aktif, dan kode cadangan
// dibuat (ditampilkan SEKALI).
async function aktifkan(userId, rahasiaEnc, kode) {
  periksaKunci(userId);
  const langkah = totp.cocokkan(dekripsi(rahasiaEnc), kode);
  if (langkah === null) {
    catatGagal(userId);
    throw new AppError(400, 'Kode salah. Pastikan jam HP tepat, lalu ketik kode yang sedang tampil.');
  }
  percobaan.recordSuccess(userId);
  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { totpSecretEnc: rahasiaEnc, totpAktifSejak: new Date(), totpLangkahTerakhir: BigInt(langkah) },
    });
    return buatKodePemulihan(tx, userId);
  });
}

// Login langkah kedua: kode 6 digit dari aplikasi, atau salah satu kode
// cadangan (XXXX-XXXX, sekali pakai).
async function verifikasi(userId, kode) {
  periksaKunci(userId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecretEnc: true, totpAktifSejak: true },
  });
  if (!user?.totpAktifSejak || !user.totpSecretEnc) {
    throw new AppError(400, '2FA belum aktif untuk akun ini.');
  }

  const teks = String(kode ?? '').trim();
  if (/^\d{6}$/.test(teks)) {
    const langkah = totp.cocokkan(dekripsi(user.totpSecretEnc), teks);
    if (langkah !== null) {
      // Atomik: kode (langkah waktu) yang sama tidak bisa dipakai dua kali,
      // termasuk oleh dua percobaan login bersamaan.
      const pakai = await prisma.$executeRaw`
        UPDATE users SET totp_langkah_terakhir = ${langkah}
        WHERE id = ${userId} AND (totp_langkah_terakhir IS NULL OR totp_langkah_terakhir < ${langkah})`;
      if (pakai === 1) {
        percobaan.recordSuccess(userId);
        return { pakaiKodeCadangan: false };
      }
    }
  } else if (normalKodePemulihan(teks).length === 8) {
    const pakai = await prisma.kodePemulihan.updateMany({
      where: { userId, kodeHash: sidikPemulihan(userId, teks), dipakaiAt: null },
      data: { dipakaiAt: new Date() },
    });
    if (pakai.count === 1) {
      percobaan.recordSuccess(userId);
      const sisa = await prisma.kodePemulihan.count({ where: { userId, dipakaiAt: null } });
      logger.warn({ userId, sisa }, 'Login memakai kode cadangan 2FA');
      return { pakaiKodeCadangan: true, sisaKodeCadangan: sisa };
    }
  }
  catatGagal(userId);
  throw new AppError(400, 'Kode 2FA salah atau sudah dipakai.');
}

// Mencabut 2FA: login berikutnya meminta setup ulang (admin wajib).
async function reset(userId) {
  await prisma.$transaction([
    prisma.kodePemulihan.deleteMany({ where: { userId } }),
    prisma.user.update({ where: { id: userId }, data: { totpSecretEnc: null, totpAktifSejak: null, totpLangkahTerakhir: null } }),
  ]);
  percobaan.recordSuccess(userId);
}

module.exports = { wajib2fa, mulaiSetup, aktifkan, verifikasi, reset, PENERBIT };
