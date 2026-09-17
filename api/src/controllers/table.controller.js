const tableService = require('../services/table.service');

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

async function qrImage(req, res) {
  const buffer = await tableService.generateQrImage(req.params.id);
  res.set('Content-Type', 'image/png');
  res.send(buffer);
}

module.exports = { list, create, update, remove, resetToken, qrImage };
