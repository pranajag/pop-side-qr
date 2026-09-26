const { Server } = require('socket.io');
const prisma = require('./lib/prisma');
const logger = require('./utils/logger');
const { tandaTangan, bacaTandaTangan } = require('./utils/kripto');

// Notifikasi realtime (Socket.IO, tech stack AGENTS.md): pesanan baru,
// panggilan meja, perubahan status, dan buka/tutup kafe sampai ke layar
// dalam hitungan milidetik, bukan menunggu polling berikutnya. Polling
// tetap ada di frontend sebagai cadangan kalau koneksi realtime putus.
//
// Autentikasi pakai TOKEN berumur 60 detik, bukan cookie: di hosting,
// frontend (vercel.app) dan API (onrender.com) beda domain, jadi cookie
// sesi tidak ikut terkirim ke koneksi WebSocket. Token diterbitkan route
// HTTP biasa yang sudah memegang semua aturan akses:
//   /staff  — GET /api/admin/realtime/token (requireAuth: akun aktif, admin
//             wajib lulus 2FA). Token hanya dipakai saat menyambung.
//   /publik — GET /api/public/orders/:kodeOrder/realtime (hanya perangkat
//             pemesan, sama dengan aturan pelacakan). Tanpa token, soket
//             publik hanya menerima status buka/tutup kafe.
//
// Isi pesan sengaja minimal (id, kode, status — tanpa nama/nomor/total):
// layar yang menerimanya memuat ulang datanya lewat API biasa.
let io = null;
const UMUR_TOKEN_MS = 60 * 1000;
const MAKS_ORDER_PER_SOKET = 10;
const PERIKSA_STAFF_SETIAP_MS = 5 * 60 * 1000;
// Soket publik tidak butuh login, jadi tanpa batas ini satu skrip bisa
// membuka ribuan koneksi dan menghabiskan memori server (paket hosting
// gratis: 512 MB). Batasnya untuk seluruh server, bukan per IP — di hosting,
// IP asli klien WebSocket tidak bisa dipastikan (header X-Forwarded-For bisa
// dipalsukan, lihat middleware/rateLimit.js). Lewat batas: koneksi baru
// ditolak, layar tetap jalan lewat polling cadangan.
const MAKS_KONEKSI = 1000;

function tokenStaff(user) {
  return tandaTangan('realtime-staff', { u: user.id, exp: Date.now() + UMUR_TOKEN_MS });
}

function tokenOrder(orderId) {
  return tandaTangan('realtime-order', { o: orderId, exp: Date.now() + UMUR_TOKEN_MS });
}

function bacaToken(ranah, token) {
  const isi = bacaTandaTangan(ranah, token);
  return isi && typeof isi.exp === 'number' && isi.exp > Date.now() ? isi : null;
}

async function autentikasiStaff(socket, next) {
  try {
    const isi = bacaToken('realtime-staff', socket.handshake.auth?.token);
    if (!isi) return next(new Error('unauthorized'));
    const user = await prisma.user.findUnique({ where: { id: isi.u }, select: { isActive: true, role: true } });
    if (!user?.isActive) return next(new Error('unauthorized'));
    socket.data.user = { id: isi.u, role: user.role };
    next();
  } catch (err) {
    logger.error({ err }, 'autentikasi realtime staff gagal');
    next(new Error('unauthorized'));
  }
}

// Akun yang dinonaktifkan tidak boleh terus menerima notifikasi lewat soket
// yang sudah tersambung sebelumnya.
async function putuskanStaffNonaktif() {
  const soket = await io.of('/staff').fetchSockets();
  const ids = [...new Set(soket.map((s) => s.data.user?.id).filter(Boolean))];
  if (!ids.length) return;
  const aktif = new Set(
    (await prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } })).map((u) => u.id)
  );
  for (const s of soket) if (!aktif.has(s.data.user?.id)) s.disconnect(true);
}

function pasang(httpServer, { originDiizinkan, maksKoneksi = MAKS_KONEKSI }) {
  const server = new Server(httpServer, {
    path: '/api/realtime',
    serveClient: false,
    // Klien hanya mengirim pesan kecil ({ token }).
    maxHttpBufferSize: 10_000,
    cors: { origin: (origin, cb) => cb(null, originDiizinkan(origin)) },
    // Dipanggil untuk setiap koneksi BARU (bukan tiap pesan). Origin juga
    // dicek di sini untuk upgrade WebSocket (tidak lewat CORS).
    allowRequest: (req, cb) =>
      cb(null, originDiizinkan(req.headers.origin) && server.engine.clientsCount < maksKoneksi),
  });
  io = server;

  const staff = io.of('/staff');
  staff.use(autentikasiStaff);
  staff.on('connection', (socket) => socket.join('staff'));
  setInterval(() => {
    putuskanStaffNonaktif().catch((err) => logger.warn({ err }, 'pemeriksaan soket staff gagal'));
  }, PERIKSA_STAFF_SETIAP_MS).unref();

  io.of('/publik').on('connection', (socket) => {
    let jumlah = 0;
    socket.on('lacak', (isi) => {
      const token = bacaToken('realtime-order', isi?.token);
      if (!token || jumlah >= MAKS_ORDER_PER_SOKET) return;
      jumlah += 1;
      socket.join(`order:${token.o}`);
    });
  });
  return io;
}

// Semua fungsi kirim aman dipanggil kapan saja — tanpa server realtime
// (tes, skrip), tidak melakukan apa-apa. Dipanggil SESUDAH transaksinya
// commit, jadi layar tidak pernah memuat data yang akhirnya dibatalkan.
function keStaff(event, data = {}) {
  io?.of('/staff').to('staff').emit(event, data);
}

function keOrder(orderId, event, data = {}) {
  io?.of('/publik').to(`order:${orderId}`).emit(event, data);
}

function kePublik(event, data = {}) {
  io?.of('/publik').emit(event, data);
}

module.exports = { pasang, keStaff, keOrder, kePublik, tokenStaff, tokenOrder };
