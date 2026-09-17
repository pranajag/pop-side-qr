const orderManagementService = require('../services/orderManagement.service');

async function list(req, res) {
  const orders = await orderManagementService.list(req.query.status);
  res.json({ orders });
}

async function confirmPayment(req, res) {
  const order = await orderManagementService.confirmPayment(req.params.id, req.session.user.id);
  res.json({ order });
}

async function updateStatus(req, res) {
  const order = await orderManagementService.updateStatus(
    req.params.id,
    req.body.status,
    req.session.user.id,
    req.body.catatan
  );
  res.json({ order });
}

module.exports = { list, confirmPayment, updateStatus };
