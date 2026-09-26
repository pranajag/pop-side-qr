const cartService = require('../services/cart.service');
const memberOtpService = require('../services/memberOtp.service');
const { tokenMember } = require('../utils/cookiePublik');

async function total(req, res) {
  const { items, customerPhone, token } = req.body;
  const terverifikasi = memberOtpService.sudahTerverifikasi(tokenMember(req), customerPhone);
  const result = await cartService.computeTotal(items, customerPhone, token, { terverifikasi });
  res.json(result);
}

module.exports = { total };
