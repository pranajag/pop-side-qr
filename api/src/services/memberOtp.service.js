const crypto = require('node:crypto');
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { sidik, sidikTelepon, samaAman, tandaTangan, bacaTandaTangan } = require('../utils/kripto');
const { kirimOtp, otpTersedia } = require('../utils/pengirimOtp');
const customerService = require('./customer.service');
const settingsService = require('./settings.service');
const loyaltyTierService = require('./loyaltyTier.service');

// OTP member di checkout publik: diskon tier member hanya berlaku setelah
// pemesan membuktikan nomor HP itu miliknya (kode dikirim ke nomor itu).
//
// Rancangan anti-kebocoran: SEBELUM terverifikasi, server tidak pernah
// mengungkap apa pun tentang sebuah nomor — member atau bukan, poinnya
// berapa. "Kirim kode" selalu menjawab hal yang sama; kode hanya benar-benar
// dikirim kalau nomor itu member yang punya diskon (tidak ada biaya kirim
// untuk nomor sembarangan, dan tidak ada yang bisa dipelajari dari jawabannya).
const BERLAKU_MS = 5 * 60 * 1000;
const MAKS_PERCOBAAN = 5;
const VERIFIKASI_BERLAKU_MS = 2 * 60 * 60 * 1000; // cookie "sudah terverifikasi"
const BATAS_HARIAN = () => Number(process.env.OTP_BATAS_HARIAN || 200);

function kodeHash(teleponHash, kode) {
  return sidik('otp', `${teleponHash}:${kode}`);
}

async function punyaDiskon(telepon) {
  if (!(await settingsService.isMemberEnabled(prisma))) return false;
  const member = await customerService.findByPhone(prisma, telepon);
  if (!member) return false;
  return Boolean(await loyaltyTierService.applicableTier(prisma, member.points));
}

async function namaToko() {
  const s = await prisma.storeSetting.findUnique({ where: { id: 1 }, select: { namaToko: true } });
  return s?.namaToko ?? null;
}

// Selalu mengembalikan jawaban yang sama, SEBELUM memeriksa nomornya: semua
// pekerjaan (cek member, simpan kode, kirim) berjalan di belakang. Kalau
// pengecekan ditunggu, nomor yang dikirimi kode akan menjawab beberapa
// milidetik lebih lambat — cukup untuk ditebak dengan mengukur berulang.
async function mintaKode(telepon) {
  if (!otpTersedia()) {
    throw new AppError(503, 'Verifikasi nomor member belum tersedia di kafe ini. Minta kasir untuk memakai diskon member.');
  }
  prosesMintaKode(telepon).catch((err) => logger.error({ err }, 'Gagal memproses permintaan OTP member'));
  return { berlakuDetik: BERLAKU_MS / 1000 };
}

// Mengembalikan kode yang dibuat (untuk tes), atau null kalau nomor ini
// tidak dikirimi kode.
async function prosesMintaKode(telepon) {
  if (!(await punyaDiskon(telepon))) return null;

  const teleponHash = sidikTelepon(telepon);
  const awalHari = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if ((await prisma.memberOtp.count({ where: { createdAt: { gte: awalHari } } })) >= BATAS_HARIAN()) {
    // Batas biaya: kalau ada yang memaksa kirim OTP massal, tagihan gateway
    // berhenti di sini. Pemilik perlu tahu — dicatat sebagai error.
    logger.error({ batas: BATAS_HARIAN() }, 'Batas harian pengiriman OTP member tercapai — OTP tidak dikirim');
    return null;
  }
  const kode = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  // Kode lama untuk nomor ini tidak berlaku lagi begitu ada kode baru.
  await prisma.memberOtp.updateMany({ where: { teleponHash, dipakaiAt: null }, data: { dipakaiAt: new Date() } });
  await prisma.memberOtp.create({
    data: { teleponHash, kodeHash: kodeHash(teleponHash, kode), expiresAt: new Date(Date.now() + BERLAKU_MS) },
  });
  await kirimOtp(telepon, kode, await namaToko());
  return kode;
}

// Kode salah/kedaluwarsa/habis percobaan/nomor tanpa kode aktif: semuanya
// dijawab dengan pesan yang sama.
const GAGAL = 'Kode salah atau sudah kedaluwarsa. Minta kode baru kalau perlu.';

async function verifikasiKode(telepon, kode) {
  const teleponHash = sidikTelepon(telepon);
  const tantangan = await prisma.memberOtp.findFirst({
    where: { teleponHash, dipakaiAt: null, expiresAt: { gt: new Date() } },
    orderBy: { id: 'desc' },
  });
  if (!tantangan || tantangan.percobaan >= MAKS_PERCOBAAN) {
    throw new AppError(400, GAGAL);
  }
  if (!samaAman(kodeHash(teleponHash, kode), tantangan.kodeHash)) {
    // Atomik: dua tebakan bersamaan tidak bisa sama-sama lolos dari batas
    // percobaan.
    await prisma.memberOtp.updateMany({
      where: { id: tantangan.id, percobaan: { lt: MAKS_PERCOBAAN } },
      data: { percobaan: { increment: 1 } },
    });
    const sisa = Math.max(0, MAKS_PERCOBAAN - tantangan.percobaan - 1);
    throw new AppError(400, sisa > 0 ? `Kode salah. Sisa ${sisa} percobaan.` : GAGAL);
  }
  // Sekali pakai — hanya satu dari dua permintaan bersamaan yang menang.
  const pakai = await prisma.memberOtp.updateMany({
    where: { id: tantangan.id, dipakaiAt: null },
    data: { dipakaiAt: new Date() },
  });
  if (pakai.count === 0) throw new AppError(400, GAGAL);
  return tandaTangan('member', { h: teleponHash, exp: Date.now() + VERIFIKASI_BERLAKU_MS });
}

// Isi cookie verifikasi (dari verifikasiKode) cocok dengan nomor ini dan
// belum kedaluwarsa?
function sudahTerverifikasi(tokenCookie, telepon) {
  if (!telepon || !tokenCookie) return false;
  const isi = bacaTandaTangan('member', tokenCookie);
  return Boolean(isi && isi.exp > Date.now() && samaAman(isi.h, sidikTelepon(telepon)));
}

module.exports = { mintaKode, prosesMintaKode, verifikasiKode, sudahTerverifikasi, VERIFIKASI_BERLAKU_MS, MAKS_PERCOBAAN };
