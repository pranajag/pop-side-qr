const staffCallService = require('../services/staffCall.service');

async function create(req, res) {
  const call = await staffCallService.create(req.body.token, req.body.catatan);
  res.status(201).json({ call });
}

async function list(req, res) {
  const calls = await staffCallService.list(req.query.status);
  res.json({ calls });
}

async function resolve(req, res) {
  const call = await staffCallService.resolve(req.params.id, req.session.user.id);
  res.json({ call });
}

module.exports = { create, list, resolve };
