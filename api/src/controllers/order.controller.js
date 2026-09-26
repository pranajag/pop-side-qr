const orderService = require('../services/order.service');
const memberOtpService = require('../services/memberOtp.service');
const { sidikPerangkat, pastikanPerangkat, tokenMember } = require('../utils/cookiePublik');
const realtime = require('../realtime');

async function create(req, res) {
  // Perangkat pemesan dikenali lewat cookie httpOnly (diterbitkan di sini
  // kalau belum ada) — hanya perangkat ini yang nanti bisa melacak order-nya.
  const deviceHash = pastikanPerangkat(req, res);
  const memberTerverifikasi = memberOtpService.sudahTerverifikasi(tokenMember(req), req.body.customerPhone);
  const { deviceHash: _sidik, ...order } = await orderService.createOrder(req.body, { deviceHash, memberTerverifikasi });
  res.status(201).json({ order });
}

async function confirmPayment(req, res) {
  const order = await orderService.confirmQrisPayment(req.params.kodeOrder, req.file?.buffer, sidikPerangkat(req));
  res.json({ order });
}

async function track(req, res) {
  const order = await orderService.getByCode(req.params.kodeOrder, sidikPerangkat(req));
  res.json({ order });
}

async function realtimeToken(req, res) {
  const id = await orderService.idMilikPerangkat(req.params.kodeOrder, sidikPerangkat(req));
  res.json({ token: realtime.tokenOrder(id) });
}

async function bill(req, res) {
  const bill = await orderService.getTableBill(req.params.token);
  res.json({ bill });
}

module.exports = { create, confirmPayment, track, realtimeToken, bill };
