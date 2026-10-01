const reservationService = require('../services/reservation.service');
const settingsService = require('../services/settings.service');

async function list(req, res) {
  const reservations = await reservationService.list(req.query.status);
  res.json({ reservations });
}

async function get(req, res) {
  const reservation = await reservationService.get(req.params.id);
  res.json({ reservation });
}

async function create(req, res) {
  const hasil = await reservationService.create(req.body, req.session.user);
  res.status(201).json(hasil);
}

async function update(req, res) {
  const reservation = await reservationService.update(req.params.id, req.body);
  res.json({ reservation });
}

async function updateStatus(req, res) {
  const reservation = await reservationService.updateStatus(req.params.id, req.body.status);
  res.json({ reservation });
}

async function catatPembayaranDp(req, res) {
  const hasil = await reservationService.catatPembayaranDp(req.params.id, req.body, req.session.user.id);
  res.status(201).json(hasil);
}

async function aturanDp(req, res) {
  res.json({ aturanDp: await settingsService.getAturanDp() });
}

async function remove(req, res) {
  await reservationService.remove(req.params.id);
  res.status(204).end();
}

async function meja(req, res) {
  res.json({ meja: await reservationService.mejaUntukForm(req.validQuery) });
}

async function linkRombongan(req, res) {
  res.json({ url: await reservationService.linkRombongan(req.params.id) });
}

async function qrRombongan(req, res) {
  const buffer = await reservationService.qrRombongan(req.params.id);
  res.set('Content-Type', 'image/png');
  // Sama seperti QR meja (table.controller.js qrImage): dimuat lewat <img>
  // dari origin dashboard; tanpa ini Helmet membuat browser menolaknya.
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  // QR ini kunci rombongan — jangan sampai tersimpan di cache bersama.
  res.set('Cache-Control', 'no-store');
  res.send(buffer);
}

module.exports = { list, get, create, update, updateStatus, catatPembayaranDp, aturanDp, remove, meja, linkRombongan, qrRombongan };
