const orderManagementService = require('../services/orderManagement.service');
const productService = require('../services/product.service');

const MAX_LIMIT = 200;

async function orders(req, res) {
  // Sudah divalidasi zod (validators/external.validator.js).
  const { since: sinceTeks, limit: limitAngka } = req.validQuery;
  const since = sinceTeks ? new Date(sinceTeks) : new Date(0);
  const limit = Math.min(limitAngka || MAX_LIMIT, MAX_LIMIT);
  const data = await orderManagementService.listSince(since, limit);
  res.json({ orders: data });
}

// hargaModal (cost price) stays out of this response — same confidentiality
// boundary product.controller.js already draws for a kasir session; a v1
// external key has no per-key scoping, so it gets the same non-admin view
// rather than the most-privileged one by default.
async function products(req, res) {
  const items = await productService.list();
  res.json({
    products: items.map(({ hargaModal, ...rest }) => rest),
  });
}

module.exports = { orders, products };
