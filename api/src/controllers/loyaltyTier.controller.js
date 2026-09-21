const loyaltyTierService = require('../services/loyaltyTier.service');

async function list(req, res) {
  const tiers = await loyaltyTierService.list();
  res.json({ tiers });
}

async function create(req, res) {
  const tier = await loyaltyTierService.create(req.body.minPoints, req.body.discountPercent);
  res.status(201).json({ tier });
}

async function update(req, res) {
  const tier = await loyaltyTierService.update(req.params.id, req.body);
  res.json({ tier });
}

async function remove(req, res) {
  await loyaltyTierService.remove(req.params.id);
  res.status(204).end();
}

module.exports = { list, create, update, remove };
