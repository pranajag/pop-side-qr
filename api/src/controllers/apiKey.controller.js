const apiKeyService = require('../services/apiKey.service');

async function list(req, res) {
  const keys = await apiKeyService.list();
  res.json({ apiKeys: keys });
}

async function create(req, res) {
  const key = await apiKeyService.create(req.body.nama);
  res.status(201).json({ apiKey: key });
}

async function revoke(req, res) {
  const key = await apiKeyService.revoke(req.params.id);
  res.json({ apiKey: key });
}

module.exports = { list, create, revoke };
