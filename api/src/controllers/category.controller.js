const categoryService = require('../services/category.service');

async function list(req, res) {
  const categories = await categoryService.list();
  res.json({ categories });
}

async function create(req, res) {
  const category = await categoryService.create(req.body);
  res.status(201).json({ category });
}

async function update(req, res) {
  const category = await categoryService.update(req.params.id, req.body);
  res.json({ category });
}

async function remove(req, res) {
  await categoryService.remove(req.params.id);
  res.status(204).end();
}

module.exports = { list, create, update, remove };
