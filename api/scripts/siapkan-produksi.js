// Menyiapkan database hosting (Aiven MySQL) untuk Popside — dijalankan oleh
// pemilik, dari laptop, di terminalnya sendiri:
//
//   npm run siapkan-produksi
//   node scripts/siapkan-produksi.js   (sama; untuk PowerShell yang memblokir npm.ps1)
//
// Password admin database hanya diketik di terminal ini (tidak tampil, tidak
// tersimpan di file mana pun). Yang dikerjakan:
//   1. membuat database popside_qr dan dua akun berhak terbatas (sama seperti
//      lokal, AGENTS.md "Database Lokal"):
//        popside_app      — dipakai API di Render: SELECT/INSERT/UPDATE/DELETE,
//                           kecuali tabel log (audit_log, order_status_log)
//                           yang hanya SELECT/INSERT — log tidak bisa diubah
//                           atau dihapus lewat akun aplikasi.
//        popside_migrate  — hanya untuk migrasi dari laptop ini.
//   2. menjalankan semua migrasi;
//   3. mengatur hak akses popside_app per tabel;
//   4. mengisi menu, meja, tier, dan info toko dari prisma/data-demo.json
//      (hanya kalau database belum punya produk);
//   5. membuat akun admin pertama + PIN (opsional); 2FA dipasang saat
//      login pertama;
//   6. menyalin isian environment Render (DATABASE_URL + rahasia aplikasi
//      acak) ke clipboard, dan mencetak DIRECT_URL untuk disimpan pemilik.
// Aman dijalankan ulang (password kedua akun diganti baru setiap kali).
//
// Butuh sertifikat CA Aiven di prisma/aiven-ca.pem (Aiven Console ->
// service -> Overview -> "CA certificate" -> Download). Sertifikat CA
// bukan rahasia; boleh ikut di-commit.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');
const mysql = require('mysql2/promise');

const API = path.resolve(__dirname, '..');
const CA = path.join(API, 'prisma', 'aiven-ca.pem');
// Mode uji (SIAPKAN_UJI_LOKAL=1) — HANYA untuk menguji skrip ini terhadap
// MySQL lokal: nama database & akun bisa diganti supaya akun lokal yang asli
// tidak tersentuh, tanpa SSL, dan jawaban diambil dari env, bukan diketik.
const UJI_LOKAL = process.env.SIAPKAN_UJI_LOKAL === '1';
const DB = process.env.SIAPKAN_DB || 'popside_qr';
const AKUN_APP = process.env.SIAPKAN_AKUN_APP || 'popside_app';
const AKUN_MIGRATE = process.env.SIAPKAN_AKUN_MIGRATE || 'popside_migrate';
const TABEL_LOG = new Set(['audit_log', 'order_status_log']);
const MIGRASI_TRIGGER = ['20260925091000_log_status_append_only', '20260926093000_audit_log_append_only'];
// Teks SQL tetap; nama & nilai selalu lewat placeholder mysql2 (?? / ?).
const SQL_HAK_LOG = 'GRANT SELECT, INSERT ON ??.?? TO ?@?';
const SQL_HAK_BIASA = 'GRANT SELECT, INSERT, UPDATE, DELETE ON ??.?? TO ?@?';

function tanya(pertanyaan, { tersembunyi = false } = {}) {
  if (UJI_LOKAL) {
    const jawab = {
      'Service URI': 'SIAPKAN_ADMIN_URL',
      'Username admin': 'SIAPKAN_USERNAME',
      Password: 'SIAPKAN_PASSWORD',
      'Ulangi password': 'SIAPKAN_PASSWORD',
      PIN: 'SIAPKAN_PIN',
      'Ulangi PIN': 'SIAPKAN_PIN',
    };
    const kunci = Object.keys(jawab).find((k) => pertanyaan.startsWith(k));
    return Promise.resolve(process.env[jawab[kunci]] ?? '');
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (tersembunyi) {
      rl._writeToOutput = (s) => {
        if (s.startsWith(pertanyaan)) process.stdout.write(pertanyaan);
      };
    }
    rl.question(pertanyaan, (jawab) => {
      rl.close();
      if (tersembunyi) process.stdout.write('\n');
      resolve(jawab.trim());
    });
  });
}

// sslcert relatif ke folder prisma/ (aturan Prisma); sslaccept=strict =
// sertifikat server dicek terhadap CA Aiven, bukan sekadar terenkripsi.
// connection_limit kecil: paket gratis membatasi jumlah koneksi.
function urlPrisma(user, password, host, port) {
  const ssl = UJI_LOKAL ? '' : 'sslaccept=strict&sslcert=./aiven-ca.pem&';
  return `mysql://${user}:${encodeURIComponent(password)}@${host}:${port}/${DB}?${ssl}connection_limit=5`;
}

function npxPrisma(args, env, { wajibBerhasil = true } = {}) {
  const r = spawnSync('npx', ['prisma', ...args], {
    cwd: API,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (wajibBerhasil && r.status !== 0) throw new Error(`prisma ${args.join(' ')} gagal`);
  return r.status === 0;
}

// Terapkan migrasi yang lebih awal dari `batas` saja: folder migrasi mulai
// `batas` dipindah sementara ke luar jangkauan Prisma, lalu dikembalikan.
function deploySebelum(env, batas) {
  const folder = path.join(API, 'prisma', 'migrations');
  const sementara = path.join(API, 'prisma', '.migrasi-ditunda');
  fs.mkdirSync(sementara, { recursive: true });
  const ditunda = fs.readdirSync(folder).filter((d) => /^\d{14}_/.test(d) && d >= batas);
  for (const d of ditunda) fs.renameSync(path.join(folder, d), path.join(sementara, d));
  try {
    npxPrisma(['migrate', 'deploy'], env);
  } finally {
    for (const d of ditunda) fs.renameSync(path.join(sementara, d), path.join(folder, d));
    fs.rmSync(sementara, { recursive: true, force: true });
  }
}

async function main() {
  if (!UJI_LOKAL && !process.stdin.isTTY) throw new Error('Jalankan langsung di terminal — password diketik interaktif.');
  if (!UJI_LOKAL && !fs.existsSync(CA)) throw new Error('prisma/aiven-ca.pem belum ada. Unduh "CA certificate" dari Aiven Console dulu.');

  console.log('Penyiapan database hosting Popside\n');
  const url = new URL(await tanya('Service URI Aiven (mysql://avnadmin:...): ', { tersembunyi: true }));
  if (url.protocol !== 'mysql:') throw new Error('Formatnya harus mysql://...');
  const host = url.hostname;
  const port = Number(url.port || 3306);
  const admin = await mysql.createConnection({
    host,
    port,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: UJI_LOKAL ? undefined : { ca: fs.readFileSync(CA), rejectUnauthorized: true },
  });

  // 1. Database + akun berhak terbatas, password acak baru.
  await admin.query('CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [DB]);
  const sandiApp = crypto.randomBytes(24).toString('base64url');
  const sandiMigrate = crypto.randomBytes(24).toString('base64url');
  for (const [nama, pw] of [[AKUN_APP, sandiApp], [AKUN_MIGRATE, sandiMigrate]]) {
    await admin.query('CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?', [nama, '%', pw]);
    await admin.query('ALTER USER ?@? IDENTIFIED BY ?', [nama, '%', pw]);
  }
  await admin.query('GRANT ALL PRIVILEGES ON ??.* TO ?@?', [DB, AKUN_MIGRATE, '%']);
  console.log('✓ database & akun popside_app / popside_migrate');

  const appUrl = urlPrisma(AKUN_APP, sandiApp, host, port);
  const migrateUrl = urlPrisma(AKUN_MIGRATE, sandiMigrate, host, port);
  const env = { DATABASE_URL: appUrl, DIRECT_URL: migrateUrl };

  // 2. Migrasi. Trigger append-only di MySQL terkelola bergantung pada
  //    pengaturan server (log_bin_trust_function_creators, hak SUPER) yang
  //    tidak selalu bisa diatur, jadi migrasi trigger ditandai diterapkan
  //    tanpa dijalankan. Log tetap append-only bagi akun aplikasi lewat hak
  //    akses tabel (langkah 3) — jalur yang sudah diuji ujung ke ujung.
  for (const nama of MIGRASI_TRIGGER) {
    deploySebelum(env, nama);
    // Gagal kalau sudah pernah ditandai (dijalankan ulang) — tidak apa-apa.
    npxPrisma(['migrate', 'resolve', '--applied', nama], env, { wajibBerhasil: false });
  }
  npxPrisma(['migrate', 'deploy'], env);
  console.log('✓ migrasi (append-only lewat hak akses tabel)');

  // 3. Hak akses popside_app per tabel.
  await admin.query('REVOKE ALL PRIVILEGES, GRANT OPTION FROM ?@?', [AKUN_APP, '%']);
  const [tabel] = await admin.query(
    'SELECT table_name AS nama FROM information_schema.tables WHERE table_schema = ? AND table_type = ?',
    [DB, 'BASE TABLE']
  );
  for (const { nama } of tabel) {
    if (nama === '_prisma_migrations') continue;
    await admin.query(TABEL_LOG.has(nama) ? SQL_HAK_LOG : SQL_HAK_BIASA, [DB, nama, AKUN_APP, '%']);
  }
  console.log('✓ hak akses popside_app (tabel log: hanya baca & tambah)');
  await admin.end();

  // 4-5. Data demo + admin pertama, lewat akun migrasi.
  process.env.DATABASE_URL = migrateUrl;
  process.env.UPLOAD_DRIVER = 'database';
  const { isiDataDemo, buatAdminPertama, tutup } = require('./lib/isiProduksi');
  try {
    const hasil = await isiDataDemo();
    console.log(hasil ? `✓ data demo: ${hasil}` : '• data demo dilewati (database sudah punya menu)');
    await buatAdminPertama(tanya);
  } finally {
    await tutup();
  }

  if (UJI_LOKAL) {
    // Untuk pemeriksaan otomatis: URL dicetak dalam format yang mudah diambil.
    console.log(`
UJI_APP_URL=${appUrl}
UJI_MIGRATE_URL=${migrateUrl}`);
    return;
  }
  // 6. Isian environment Render lengkap — DATABASE_URL + rahasia aplikasi
  //    yang dibuat acak di sini — langsung ke clipboard, tidak ditampilkan:
  //    di Render cukup "Add from .env" lalu tempel. Blueprint (yang membuat
  //    rahasianya sendiri) meminta kartu kredit walau paket gratis, jadi
  //    service dibuat manual dan rahasianya disiapkan di sini.
  const blokRender = isianRender(appUrl);
  const tersalin = keClipboard(blokRender);
  console.log(`
============================================================
${
  tersalin
    ? `Isian environment Render (${blokRender.split('\n').length} baris) SUDAH DISALIN ke clipboard.
Render -> Web Service -> Environment -> "Add from .env" -> tempel (Ctrl+V).

PENTING: tempel juga ke catatan pribadi / password manager sebagai
cadangan. DATA_ENC_KEY & DATA_HASH_KEY di dalamnya tidak bisa dibuat ulang —
kalau hilang, nomor HP member & 2FA admin tidak bisa dibaca lagi.`
    : `Clipboard tidak tersedia. Isian environment untuk Render:

${blokRender}`
}

Simpan juga di tempat aman (JANGAN dibagikan) untuk migrasi berikutnya:

  DIRECT_URL = ${migrateUrl}
============================================================`);
}

// Nilai sama dengan render.yaml. Kunci 32 byte base64 = format yang dibaca
// src/utils/kripto.js.
function isianRender(databaseUrl) {
  const acak = () => crypto.randomBytes(32).toString('base64');
  return [
    'NODE_ENV=production',
    'NODE_VERSION=22',
    'TZ=Asia/Jakarta',
    `DATABASE_URL=${databaseUrl}`,
    `SESSION_SECRET=${acak()}`,
    `CSRF_SECRET=${acak()}`,
    `QR_HMAC_SECRET=${acak()}`,
    `DATA_ENC_KEY=${acak()}`,
    `DATA_HASH_KEY=${acak()}`,
    'UPLOAD_DRIVER=database',
    'TRUST_PROXY=2',
    'CORS_ORIGIN=https://popside-admin.vercel.app,https://popside-menu.vercel.app',
    'PUBLIC_WEB_URL=https://popside-menu.vercel.app',
    'OTP_PENGIRIM=console',
  ].join('\n');
}

function keClipboard(teks) {
  const perintah = { win32: ['clip', []], darwin: ['pbcopy', []] }[process.platform];
  if (!perintah) return false;
  const r = spawnSync(perintah[0], perintah[1], { input: teks });
  return r.status === 0;
}

main().catch((err) => {
  console.error(`\nGagal: ${err.message}`);
  process.exitCode = 1;
});
