const session = require('express-session');
const prisma = require('../lib/prisma');
const logger = require('./logger');

// Penyimpanan sesi login admin/kasir di MySQL (tabel `sessions`), pengganti
// MemoryStore bawaan express-session. MemoryStore menyimpan sesi di memori
// proses: setiap API restart semua staff ter-logout, dan di produksi ia
// bocor memori — dokumentasi express-session sendiri melarangnya.
//
// Sengaja memakai database yang sudah ada, bukan Redis: sesi tetap bertahan
// saat restart tanpa menambah server baru untuk satu kafe. Isi sesi cuma
// id + username + role (auth.service.js), jadi tidak ada data sensitif
// tambahan yang ikut tersimpan.
const TTL_BAWAAN_MS = 30 * 60 * 1000;
const BERSIHKAN_SETIAP_MS = 15 * 60 * 1000;
const SENTUH_PALING_SERING_MS = 60 * 1000;

function kedaluwarsaDari(sess) {
  const expires = sess?.cookie?.expires ? new Date(sess.cookie.expires) : null;
  if (expires && !Number.isNaN(expires.getTime())) return expires;
  return new Date(Date.now() + (sess?.cookie?.originalMaxAge ?? TTL_BAWAAN_MS));
}

class PrismaSessionStore extends session.Store {
  // bersihkanOtomatis: false untuk instance yang hanya membaca (realtime.js)
  // — pembersihan cukup dijalankan satu instance.
  constructor({ bersihkanOtomatis = true } = {}) {
    super();
    if (!bersihkanOtomatis) return;
    // Sesi kedaluwarsa dibuang berkala. unref(): timer ini tidak boleh
    // menahan proses tetap hidup saat server dimatikan.
    this.timer = setInterval(() => {
      this.bersihkanKedaluwarsa().catch((err) => logger.warn({ err }, 'pembersihan sesi kedaluwarsa gagal'));
    }, BERSIHKAN_SETIAP_MS);
    this.timer.unref();
  }

  async bersihkanKedaluwarsa() {
    return prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }

  get(sid, cb) {
    (async () => {
      const row = await prisma.session.findUnique({ where: { sid } });
      if (!row || row.expiresAt <= new Date()) return null;
      return JSON.parse(row.data);
    })().then((sess) => cb(null, sess), (err) => cb(err));
  }

  set(sid, sess, cb) {
    const expiresAt = kedaluwarsaDari(sess);
    const data = JSON.stringify(sess);
    prisma.session
      .upsert({ where: { sid }, create: { sid, data, expiresAt }, update: { data, expiresAt } })
      .then(() => cb?.(null), (err) => cb?.(err));
  }

  destroy(sid, cb) {
    prisma.session.deleteMany({ where: { sid } }).then(() => cb?.(null), (err) => cb?.(err));
  }

  // rolling: true memanggil ini di setiap respons — cukup geser waktu
  // kedaluwarsanya, isi sesinya tidak berubah.
  // rolling: true (app.js) memanggil touch di SETIAP respons staff — tanpa
  // penghemat ini, tiap klik admin = satu tulis database tambahan hanya untuk
  // menggeser batas kedaluwarsa. Cukup sekali per menit per sesi: dengan
  // batas idle 30 menit, selisih paling lama 1 menit itu tidak terasa.
  touch(sid, sess, cb) {
    const sekarang = Date.now();
    if (sekarang - (this.sentuhanTerakhir?.get(sid) ?? 0) < SENTUH_PALING_SERING_MS) {
      cb?.(null);
      return;
    }
    this.sentuhanTerakhir ??= new Map();
    this.sentuhanTerakhir.set(sid, sekarang);
    if (this.sentuhanTerakhir.size > 10_000) this.sentuhanTerakhir.clear();
    prisma.session
      .updateMany({ where: { sid }, data: { expiresAt: kedaluwarsaDari(sess) } })
      .then(() => cb?.(null), (err) => cb?.(err));
  }
}

module.exports = { PrismaSessionStore };
