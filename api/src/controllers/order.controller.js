const orderService = require('../services/order.service');
const memberOtpService = require('../services/memberOtp.service');
const { sidikPerangkat, pastikanPerangkat, tokenMember } = require('../utils/cookiePublik');
const realtime = require('../realtime');

async function create(req, res) {
  // Perangkat pemesan dikenali lewat cookie httpOnly (diterbitkan di sini
  // kalau belum ada) — hanya perangkat ini yang nanti bisa melacak order-nya.
  const deviceHash = pastikanPerangkat(req, res);
  const akses = memberOtpService.aksesDiskonMember(tokenMember(req), req.body.customerPhone);
  const { deviceHash: _sidik, ...order } = await orderService.createOrder(req.body, {
    deviceHash,
    memberTerverifikasi: akses.terverifikasi,
    diskonMemberBoleh: akses.boleh,
  });
  res.status(201).json({ order: { ...order, discountReason: orderService.alasanUntukPelanggan(order.discountReason) } });
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

// Customer selesai dengan struk digitalnya — pesanan dilepas dari perangkat.
async function tutupStruk(req, res) {
  await orderService.tutupStruk(req.params.kodeOrder, sidikPerangkat(req));
  res.status(204).end();
}

async function milikPerangkat(req, res) {
  res.json({ orders: await orderService.daftarMilikPerangkat(sidikPerangkat(req)) });
}

async function bill(req, res) {
  const bill = await orderService.getTableBill(req.params.token);
  res.json({ bill });
}

module.exports = { create, confirmPayment, track, realtimeToken, tutupStruk, milikPerangkat, bill };
