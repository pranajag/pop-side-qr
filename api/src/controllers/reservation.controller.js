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
  const reservation = await reservationService.update(req.params.id, req.body, req.session.user);
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

module.exports = { list, get, create, update, updateStatus, catatPembayaranDp, aturanDp, remove };
