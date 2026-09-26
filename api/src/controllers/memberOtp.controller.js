const memberOtpService = require('../services/memberOtp.service');
const tableService = require('../services/table.service');
const AppError = require('../utils/AppError');
const { setTokenMember } = require('../utils/cookiePublik');

// Hanya untuk orang yang benar-benar di meja (token QR sah), sama seperti
// membuat order.
async function pastikanMeja(token) {
  if (!(await tableService.verifyToken(token))) {
    throw new AppError(404, 'Meja tidak valid. Coba scan ulang QR.');
  }
}

async function minta(req, res) {
  await pastikanMeja(req.body.token);
  const hasil = await memberOtpService.mintaKode(req.body.customerPhone);
  // Jawaban sama untuk nomor apa pun — lihat memberOtp.service.js.
  res.status(202).json({
    ...hasil,
    pesan: 'Kalau nomor ini punya diskon member, kode verifikasi dikirim ke nomor tersebut.',
  });
}

async function verifikasi(req, res) {
  await pastikanMeja(req.body.token);
  const token = await memberOtpService.verifikasiKode(req.body.customerPhone, req.body.kode);
  setTokenMember(res, token, memberOtpService.VERIFIKASI_BERLAKU_MS);
  res.json({ terverifikasi: true });
}

module.exports = { minta, verifikasi };
