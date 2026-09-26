const orderManagementService = require('../services/orderManagement.service');
const orderService = require('../services/order.service');

async function list(req, res) {
  const orders = await orderManagementService.list(req.query.status);
  res.json({ orders });
}

async function createManual(req, res) {
  const order = await orderService.createManualOrder({ ...req.body, userId: req.session.user.id });
  res.status(201).json({ order });
}

async function confirmPayment(req, res) {
  const order = await orderManagementService.confirmPayment(
    req.params.id,
    req.session.user.id,
    req.body.cashReceived,
    req.body.pin
  );
  res.json({ order });
}

async function updateStatus(req, res) {
  const order = await orderManagementService.updateStatus(
    req.params.id,
    req.body.status,
    req.session.user.id,
    req.body.catatan,
    req.body.refundAmount,
    req.body.pin
  );
  res.json({ order });
}

async function buktiBayar(req, res, next) {
  await orderManagementService.serveBuktiBayar(req.params.id, res, next);
}

async function activityLog(req, res) {
  const logs = await orderManagementService.listActivity(req.query.limit);
  res.json({ logs });
}

module.exports = { list, createManual, confirmPayment, updateStatus, buktiBayar, activityLog };
