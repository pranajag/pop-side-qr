// Tes penjaga keamanan — murni, tanpa database. Jalankan: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { isBlockedIp, kirimAman } = require('../src/utils/ssrfGuard');
const { detectImageType } = require('../src/utils/fileSignature');
const pinAttempts = require('../src/utils/pinAttempts');
const { samarkanNomor, samarkanObjek } = require('../src/utils/logger');
const kripto = require('../src/utils/kripto');

// Kunci acak khusus tes ini (proses terpisah dari API) — tes enkripsi tidak
// butuh dan tidak menyentuh kunci asli di .env.
function pakaiKunciUji() {
  process.env.DATA_ENC_KEY = crypto.randomBytes(32).toString('base64');
  process.env.DATA_HASH_KEY = crypto.randomBytes(32).toString('base64');
}

test('enkripsi: bolak-balik, IV acak, dan data yang diutak-atik ditolak', () => {
  pakaiKunciUji();
  const a = kripto.enkripsi('081234567890');
  const b = kripto.enkripsi('081234567890');
  assert.notEqual(a, b, 'nomor sama menghasilkan ciphertext berbeda (IV acak)');
  assert.ok(!a.includes('081234567890'));
  assert.equal(kripto.dekripsi(a), '081234567890');
  const [versi, isi] = a.split('.');
  const buf = Buffer.from(isi, 'base64url');
  buf[buf.length - 1] ^= 1;
  assert.throws(() => kripto.dekripsi(`${versi}.${buf.toString('base64url')}`), 'ciphertext diubah 1 bit');
  process.env.DATA_ENC_KEY = crypto.randomBytes(32).toString('base64');
  assert.throws(() => kripto.dekripsi(a), 'kunci lain tidak bisa membuka');
});

test('enkripsi: sidik stabil, ranah terpisah, token bertanda tangan tidak bisa dipalsukan', () => {
  pakaiKunciUji();
  assert.equal(kripto.sidikTelepon('081234567890'), kripto.sidikTelepon('081234567890'));
  assert.notEqual(kripto.sidik('telepon', 'x'), kripto.sidik('perangkat', 'x'));
  const token = kripto.tandaTangan('member', { h: 'abc', exp: 123 });
  assert.deepEqual(kripto.bacaTandaTangan('member', token), { h: 'abc', exp: 123 });
  assert.equal(kripto.bacaTandaTangan('perangkat', token), null, 'ranah lain');
  const [isi, tanda] = token.split('.');
  const palsu = Buffer.from(JSON.stringify({ h: 'abc', exp: 999999 })).toString('base64url');
  assert.equal(kripto.bacaTandaTangan('member', `${palsu}.${tanda}`), null, 'isi diubah');
  assert.equal(kripto.bacaTandaTangan('member', `${isi}.${'0'.repeat(64)}`), null, 'tanda diubah');
});

test('enkripsi: API menolak start tanpa kunci yang benar', () => {
  const simpan = { enc: process.env.DATA_ENC_KEY, hash: process.env.DATA_HASH_KEY };
  process.env.DATA_ENC_KEY = '';
  assert.throws(() => kripto.periksaKunci(), /DATA_ENC_KEY/);
  process.env.DATA_ENC_KEY = Buffer.alloc(16).toString('base64');
  assert.throws(() => kripto.periksaKunci(), /32 byte/);
  process.env.DATA_ENC_KEY = process.env.DATA_HASH_KEY = crypto.randomBytes(32).toString('base64');
  assert.throws(() => kripto.periksaKunci(), /berbeda/);
  process.env.DATA_ENC_KEY = simpan.enc;
  process.env.DATA_HASH_KEY = simpan.hash;
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  assert.match(app, /periksaKunci\(\);/);
});

test('2FA TOTP: cocok dengan test vector resmi RFC 6238', () => {
  const totp = require('../src/utils/totp');
  const rahasia = Buffer.from('12345678901234567890', 'ascii');
  for (const [detik, kode] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']]) {
    assert.equal(totp.kodePada(rahasia, Math.floor(detik / 30)), kode, `T=${detik}`);
  }
  const b32 = totp.base32Encode(rahasia);
  assert.equal(b32, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(totp.cocokkan(b32, '287082', 59_000), 1);
  assert.equal(totp.cocokkan(b32, '287082', 59_000 + 90_000), null, 'kode 90 detik lalu sudah tidak berlaku');
  assert.equal(totp.cocokkan(b32, '28708', 59_000), null);
  assert.match(totp.otpauthUrl({ rahasia: b32, akun: 'admin', penerbit: 'Popside' }), /^otpauth:\/\/totp\/Popside:admin\?secret=GEZDG/);
});

test('OTP: mode console mati di produksi; gateway HTTP menerima nomor & kode dengan token', async () => {
  const http = require('node:http');
  const simpan = { ...process.env };
  const pengirim = require('../src/utils/pengirimOtp');
  try {
    process.env.OTP_PENGIRIM = 'console';
    process.env.NODE_ENV = 'production';
    assert.equal(pengirim.otpTersedia(), false, 'kode OTP tidak boleh berakhir di log produksi');
    process.env.NODE_ENV = 'development';
    assert.equal(pengirim.otpTersedia(), true);

    let diterima = null;
    const server = await new Promise((r) => {
      const s = http.createServer((req, res) => {
        let isi = '';
        req.on('data', (c) => (isi += c));
        req.on('end', () => {
          diterima = { auth: req.headers.authorization, isi: new URLSearchParams(isi) };
          res.end('{"status":true}');
        });
      });
      s.listen(0, '127.0.0.1', () => r(s));
    });
    process.env.OTP_PENGIRIM = 'http';
    process.env.OTP_HTTP_URL = `http://127.0.0.1:${server.address().port}/send`;
    process.env.OTP_HTTP_TOKEN = 'token-gateway-uji';
    assert.equal(pengirim.otpTersedia(), true);
    await pengirim.kirimOtp('081234567890', '482913', 'Popside');
    server.close();
    assert.equal(diterima.auth, 'token-gateway-uji');
    assert.equal(diterima.isi.get('target'), '6281234567890');
    assert.match(diterima.isi.get('message'), /482913/);

    process.env.OTP_HTTP_URL = 'http://gateway.contoh.com/send';
    await assert.rejects(pengirim.kirimOtp('081234567890', '482913', 'Popside'), /https/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in simpan)) delete process.env[k];
    Object.assign(process.env, simpan);
  }
});

test('webhook (SSRF): alamat jaringan internal ditolak, alamat publik boleh', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1']) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  assert.equal(isBlockedIp('8.8.8.8'), false);
});

test('webhook (SSRF): bentuk lain penulisan alamat internal tetap ditolak', () => {
  const internal = [
    '0:0:0:0:0:0:0:1', // ::1 ditulis lengkap
    '::ffff:127.0.0.1', // IPv4-mapped, bentuk titik
    '::ffff:7f00:1', // IPv4-mapped, bentuk heksa
    '::7f00:1', // IPv4-compatible (usang)
    '::ffff:0:a00:1', // IPv4-translated -> 10.0.0.1
    '64:ff9b::7f00:1', // NAT64 -> 127.0.0.1
    '64:ff9b::c0a8:101', // NAT64 -> 192.168.1.1
    '2002:a9fe:a9fe::1', // 6to4 -> 169.254.169.254 (metadata cloud)
    'fe80::1%eth0', // link-local dengan zone id
    'febf::1', // ujung atas fe80::/10
    'fec0::1', // site-local
    'fd12:3456::1', // unique local
    'ff02::1', // multicast
    '2001:db8::1', // dokumentasi
    'bukan-alamat',
  ];
  for (const ip of internal) assert.equal(isBlockedIp(ip), true, ip);
  const publik = ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1'];
  for (const ip of publik) assert.equal(isBlockedIp(ip), false, ip);
});

test('webhook (SSRF): protokol selain http/https dan IP internal ditolak sebelum konek', async () => {
  await assert.rejects(kirimAman('file:///etc/passwd'), /Protokol tidak diizinkan/);
  await assert.rejects(kirimAman('http://127.0.0.1:3000/api'), (err) => err.code === 'SSRF_BLOCKED');
  // Parser URL membakukan desimal/heksa/IPv6 ke bentuk standar dulu — tetap ketahuan.
  for (const url of ['http://2130706433:3000/', 'http://0x7f.1:3000/', 'http://[::ffff:127.0.0.1]:3000/', 'http://[64:ff9b::7f00:1]/']) {
    await assert.rejects(kirimAman(url), (err) => err.code === 'SSRF_BLOCKED', url);
  }
});

test('upload: isi bukan gambar ditolak walau namanya .jpg', () => {
  const bukanGambar = Buffer.from('bukan gambar, cuma teks biasa');
  assert.equal(detectImageType(bukanGambar), null);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(detectImageType(png)?.type, 'png');
});

test('PIN void: 3x salah terkunci 15 menit, per akun', () => {
  const t0 = 1_000_000;
  const akun = 424242;
  pinAttempts.recordSuccess(akun);
  assert.equal(pinAttempts.recordFailure(akun, t0), false);
  assert.equal(pinAttempts.recordFailure(akun, t0 + 1000), false);
  assert.equal(pinAttempts.isLocked(akun, t0 + 2000), false, 'belum terkunci setelah 2x');
  assert.equal(pinAttempts.recordFailure(akun, t0 + 2000), true, 'salah ke-3 yang mengunci (dicatat ke log)');
  assert.equal(pinAttempts.isLocked(akun, t0 + 3000), true, 'terkunci setelah 3x');
  assert.equal(pinAttempts.isLocked(akun + 1, t0 + 3000), false, 'akun lain tidak ikut terkunci');
  assert.equal(pinAttempts.isLocked(akun, t0 + 2000 + 14 * 60 * 1000), true, 'masih terkunci di menit ke-14');
  assert.equal(pinAttempts.isLocked(akun, t0 + 2000 + 15 * 60 * 1000 + 1), false, 'terbuka setelah 15 menit');
});

test('log: nomor HP disamarkan, rahasia di header tidak ikut tercatat', () => {
  assert.equal(samarkanNomor('/api/admin/customers?search=081277778888'), '/api/admin/customers?search=0812******88');
  assert.deepEqual(samarkanObjek({ search: '081277778888', halaman: '2' }), { search: '0812******88', halaman: '2' });
  const sumber = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'logger.js'), 'utf8');
  for (const header of ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]']) {
    assert.ok(sumber.includes(header), `redaksi ${header}`);
  }
});

test('sesi: tersimpan di database, cookie __Host- httpOnly sameSite=strict di produksi', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  assert.match(app, /store: new PrismaSessionStore\(\)/);
  assert.match(app, /name: SESSION_COOKIE_NAME/);
  assert.match(app, /httpOnly: true/);
  assert.match(app, /sameSite: 'strict'/);
  assert.match(app, /secure: isProd/);
  const util = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'session.js'), 'utf8');
  assert.match(util, /SESSION_COOKIE_NAME = isProd \? '__Host-popside\.sid' : 'popside\.sid'/);
});

test('logout: menghapus cookie sesi dengan nama & atribut yang sama seperti saat dibuat', () => {
  const sumber = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'auth.controller.js'), 'utf8');
  assert.match(sumber, /res\.clearCookie\(SESSION_COOKIE_NAME, SESSION_COOKIE_CLEAR_OPTIONS\)/);
  const { SESSION_COOKIE_CLEAR_OPTIONS } = require('../src/utils/session');
  assert.equal(SESSION_COOKIE_CLEAR_OPTIONS.path, '/', 'cookie __Host- wajib Path=/');
  assert.equal(SESSION_COOKIE_CLEAR_OPTIONS.sameSite, 'strict');
});

test('trust proxy: mati kecuali diatur lewat TRUST_PROXY', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  assert.match(app, /trustProxyDariEnv\(process\.env\.TRUST_PROXY\)/);
  assert.doesNotMatch(app, /app\.set\('trust proxy', (true|1)\)/);
});

test('database hosting: sertifikat CA dibaca dari folder prisma/, TLS tetap diverifikasi', () => {
  const { urlDenganSertifikatAbsolut } = require('../src/utils/urlDatabase');
  const url = 'mysql://popside_app:rahasia@db.example:3306/popside_qr?sslaccept=strict&sslcert=./aiven-ca.pem&connection_limit=5';
  const hasil = new URL(urlDenganSertifikatAbsolut(url));
  const sertifikat = hasil.searchParams.get('sslcert');
  assert.equal(path.resolve(sertifikat), path.resolve(__dirname, '..', 'prisma', 'aiven-ca.pem'));
  assert.equal(hasil.searchParams.get('sslaccept'), 'strict', 'verifikasi sertifikat server tidak dilonggarkan');
  assert.equal(hasil.searchParams.get('connection_limit'), '5');
  assert.equal(hasil.password, 'rahasia');
  // Tanpa sertifikat relatif (database lokal, path absolut): tidak diubah.
  const lokal = 'mysql://popside_app:x@127.0.0.1:3306/popside_qr';
  assert.equal(urlDenganSertifikatAbsolut(lokal), lokal);
  const absolut = 'mysql://u:p@h:1/d?sslcert=/etc/ssl/ca.pem';
  assert.equal(urlDenganSertifikatAbsolut(absolut), absolut);
});

test('API key: hanya lewat header Authorization, tidak pernah lewat query', () => {
  const sumber = fs.readFileSync(path.join(__dirname, '..', 'src', 'middleware', 'requireApiKey.js'), 'utf8');
  assert.match(sumber, /req\.get\('authorization'\)/);
  assert.doesNotMatch(sumber, /req\.query/);
});

test('RBAC: setiap router admin memasang pengecekan login dan peran', () => {
  const folder = path.join(__dirname, '..', 'src', 'routes');
  const tanpaPeran = fs
    .readdirSync(folder)
    .filter((f) => !['public.routes.js', 'auth.routes.js', 'external.routes.js'].includes(f))
    .filter((f) => !/requireRole\(/.test(fs.readFileSync(path.join(folder, f), 'utf8')));
  assert.deepEqual(tanpaPeran, []);
  const produk = fs.readFileSync(path.join(folder, 'product.routes.js'), 'utf8');
  assert.match(produk, /router\.delete\('\/:id', requireRole\('admin'\)/);
});
