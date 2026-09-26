const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { generateCsrfToken } = require('../middleware/csrf');
const { regenerateSession, destroySession } = require('../utils/session');
const twoFactor = require('./twoFactor.service');

// Precomputed once at startup so a login attempt for a username that
// doesn't exist still pays the same bcrypt cost as a real one — otherwise
// response timing would leak which usernames exist.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-constant-time-compare', 12);

// Jeda antara password benar dan kode 2FA. Lewat dari ini, ulangi dari
// password — sesi setengah-login tidak boleh menggantung lama.
const PENDING_2FA_MS = 5 * 60 * 1000;

function userSesi(user) {
  return { id: user.id, username: user.username, role: user.role };
}

// Login selesai: session id diganti (mencegah session fixation), user
// ditaruh di sesi, dan token CSRF baru diterbitkan (token lama terikat ke
// session id yang lama).
async function selesaikanLogin(req, res, user, { duaFaktor }) {
  await regenerateSession(req);
  req.session.user = userSesi(user);
  req.session.duaFaktor = duaFaktor;
  const csrfToken = generateCsrfToken(req, res, { overwrite: true });
  return { user: req.session.user, csrfToken };
}

async function login(req, res, username, password) {
  const user = await prisma.user.findUnique({ where: { username } });

  if (!user || !user.isActive) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw new AppError(401, 'Invalid username or password');
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    throw new AppError(401, 'Invalid username or password');
  }

  // Password benar, tapi admin (atau siapa pun yang sudah memasang 2FA)
  // BELUM login: sesi hanya mencatat "menunggu kode 2FA", tanpa user —
  // tidak ada satu pun route admin yang terbuka dengan keadaan ini.
  if (twoFactor.wajib2fa(user)) {
    req.session.pending2fa = {
      userId: user.id,
      exp: Date.now() + PENDING_2FA_MS,
      setup: !user.totpAktifSejak,
    };
    return { langkah: user.totpAktifSejak ? 'kode-2fa' : 'setup-2fa' };
  }

  return selesaikanLogin(req, res, user, { duaFaktor: false });
}

// Keadaan "password benar, menunggu 2FA" yang masih berlaku, beserta
// usernya. `setup`: true = belum punya 2FA (harus memasang dulu).
async function ambilPending(req, { setup }) {
  const pending = req.session?.pending2fa;
  if (!pending || pending.exp < Date.now()) {
    if (req.session) delete req.session.pending2fa;
    throw new AppError(401, 'Sesi login sudah kedaluwarsa. Ulangi dengan username dan password.');
  }
  if (Boolean(pending.setup) !== setup) {
    throw new AppError(400, setup ? '2FA akun ini sudah aktif — masukkan kodenya.' : 'Pasang 2FA dulu untuk akun ini.');
  }
  const user = await prisma.user.findUnique({ where: { id: pending.userId } });
  if (!user || !user.isActive) {
    delete req.session.pending2fa;
    throw new AppError(401, 'Sesi login sudah kedaluwarsa. Ulangi dengan username dan password.');
  }
  // Untuk log audit: percobaan 2FA dicatat atas nama akun ini walau belum
  // login penuh (middleware/auditLog.js).
  req.auditUser = userSesi(user);
  return { pending, user };
}

async function setup2fa(req) {
  const { pending, user } = await ambilPending(req, { setup: true });
  // Rahasia baru setiap kali halaman setup dibuka, disimpan TERENKRIPSI di
  // sesi sampai kode pertamanya terbukti benar.
  const { rahasiaEnc, tampil } = await twoFactor.mulaiSetup(user.username);
  pending.rahasiaEnc = rahasiaEnc;
  req.session.pending2fa = pending;
  return tampil;
}

async function aktifkan2fa(req, res, kode) {
  const { pending, user } = await ambilPending(req, { setup: true });
  if (!pending.rahasiaEnc) {
    throw new AppError(400, 'Buka langkah pemasangan 2FA dulu (scan QR).');
  }
  const kodePemulihan = await twoFactor.aktifkan(user.id, pending.rahasiaEnc, kode);
  const hasil = await selesaikanLogin(req, res, user, { duaFaktor: true });
  return { ...hasil, kodePemulihan };
}

async function verifikasi2fa(req, res, kode) {
  const { user } = await ambilPending(req, { setup: false });
  const info = await twoFactor.verifikasi(user.id, kode);
  const hasil = await selesaikanLogin(req, res, user, { duaFaktor: true });
  return { ...hasil, ...info };
}

async function logout(req) {
  await destroySession(req);
}

module.exports = { login, setup2fa, aktifkan2fa, verifikasi2fa, logout };
