const webhookService = require('../services/webhook.service');

async function list(req, res) {
  const webhooks = await webhookService.list();
  res.json({ webhooks, availableEvents: webhookService.VALID_EVENTS });
}

async function create(req, res) {
  const webhook = await webhookService.create(req.body.url, req.body.events);
  res.status(201).json({ webhook });
}

async function remove(req, res) {
  await webhookService.remove(req.params.id);
  res.status(204).end();
}

async function setActive(req, res) {
  const webhook = await webhookService.setActive(req.params.id, req.body.isActive);
  res.json({ webhook });
}

module.exports = { list, create, remove, setActive };
