const cartService = require('../services/cart.service');

async function total(req, res) {
  const result = await cartService.computeTotal(req.body.items, req.body.customerPhone);
  res.json(result);
}

module.exports = { total };
