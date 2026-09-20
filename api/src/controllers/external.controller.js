const orderManagementService = require('../services/orderManagement.service');
const productService = require('../services/product.service');
const AppError = require('../utils/AppError');

const MAX_LIMIT = 200;

async function orders(req, res) {
  const since = req.query.since ? new Date(req.query.since) : new Date(0);
  if (Number.isNaN(since.getTime())) {
    throw new AppError(400, 'Parameter since harus tanggal ISO 8601 yang valid');
  }
  const limit = Math.min(Number(req.query.limit) || MAX_LIMIT, MAX_LIMIT);
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
