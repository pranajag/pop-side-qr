const productService = require('../services/product.service');

async function list(req, res) {
  const products = await productService.list();
  res.json({ products });
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
