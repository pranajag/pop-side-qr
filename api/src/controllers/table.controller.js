const tableService = require('../services/table.service');
const reservationService = require('../services/reservation.service');
const AppError = require('../utils/AppError');

async function list(req, res) {
  const tables = await tableService.list();
  res.json({ tables });
}

async function create(req, res) {
  const table = await tableService.create(req.body);
  res.status(201).json({ table });
}

async function update(req, res) {
  const table = await tableService.update(req.params.id, req.body);
  res.json({ table });
}

async function remove(req, res) {
  await tableService.remove(req.params.id);
  res.status(204).end();
}

async function resetToken(req, res) {
  const table = await tableService.resetToken(req.params.id);
  res.json({ table });
}

async function setBillOpen(req, res) {
  const table = await tableService.setBillOpen(req.params.id, req.body.isBillOpen);
  res.json({ table });
}

async function clearVisit(req, res) {
  const table = await tableService.clearVisit(req.params.id);
  res.json({ table });
}

async function qrImage(req, res) {
  const buffer = await tableService.generateQrImage(req.params.id);
  res.set('Content-Type', 'image/png');
  // Same cross-origin gap as product/QRIS photos (see imageStore.js) —
  // admin-web loads this via <img src> from a different origin (port),
  // and Helmet's default Cross-Origin-Resource-Policy: same-origin
  // otherwise makes the browser refuse to render a successfully-fetched
  // image. This one isn't served through imageStore.js (it's generated
  // on the fly, not read from the upload store), so it needs its own header.
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(buffer);
}

async function verifyToken(req, res) {
  const table = await tableService.verifyToken(req.params.token);
  if (!table) {
    throw new AppError(404, 'QR tidak valid atau meja tidak aktif. Coba scan ulang atau panggil staff.');
  }
  const reservasi = await reservationService.reservasiUntukMejaPublik(table.id);
  res.json({ table: { ...table, reservasi } });
}

module.exports = { list, create, update, remove, resetToken, setBillOpen, clearVisit, qrImage, verifyToken };
