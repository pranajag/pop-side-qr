const productService = require('../services/product.service');

// hargaModal (cost price/HPP) is business-confidential the same way
// shift.controller.js treats cash-reconciliation accuracy — a kasir needs
// this list for stock/availability, not profit margin.
function redactCost(product) {
  const { hargaModal, ...rest } = product;
  return rest;
}

async function list(req, res) {
  const products = await productService.list();
  const isAdmin = req.session.user.role === 'admin';
  res.json({ products: isAdmin ? products : products.map(redactCost) });
}

async function create(req, res) {
  const product = await productService.create(req.body, req.file?.buffer);
  res.status(201).json({ product });
}

async function update(req, res) {
  const product = await productService.update(req.params.id, req.body, req.file?.buffer);
  res.json({ product });
}

async function remove(req, res) {
  await productService.remove(req.params.id);
  res.status(204).end();
}

module.exports = { list, create, update, remove };
