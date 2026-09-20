const customerService = require('../services/customer.service');

async function list(req, res) {
  const customers = await customerService.list(req.query.search);
  res.json({ customers });
}

async function get(req, res) {
  const customer = await customerService.get(req.params.id);
  res.json({ customer });
}

module.exports = { list, get };
