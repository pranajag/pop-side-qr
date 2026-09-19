const orderService = require('../services/order.service');

async function create(req, res) {
  const order = await orderService.createOrder(req.body);
  res.status(201).json({ order });
}

async function confirmPayment(req, res) {
  const order = await orderService.confirmQrisPayment(req.params.kodeOrder, req.file?.buffer);
  res.json({ order });
}

async function track(req, res) {
  const order = await orderService.getByCode(req.params.kodeOrder);
  res.json({ order });
}

async function bill(req, res) {
  const bill = await orderService.getTableBill(req.params.token);
  res.json({ bill });
}

module.exports = { create, confirmPayment, track, bill };
