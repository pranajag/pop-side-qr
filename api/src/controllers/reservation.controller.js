const reservationService = require('../services/reservation.service');

async function list(req, res) {
  const reservations = await reservationService.list(req.query.status);
  res.json({ reservations });
}

async function get(req, res) {
  const reservation = await reservationService.get(req.params.id);
  res.json({ reservation });
}

async function create(req, res) {
  const reservation = await reservationService.create(req.body);
  res.status(201).json({ reservation });
}

async function update(req, res) {
  const reservation = await reservationService.update(req.params.id, req.body);
  res.json({ reservation });
}

async function updateStatus(req, res) {
  const reservation = await reservationService.updateStatus(req.params.id, req.body.status);
  res.json({ reservation });
}

async function setDepositPaid(req, res) {
  const reservation = await reservationService.setDepositPaid(req.params.id, req.body.metode);
  res.json({ reservation });
}

async function remove(req, res) {
  await reservationService.remove(req.params.id);
  res.status(204).end();
}

module.exports = { list, get, create, update, updateStatus, setDepositPaid, remove };
