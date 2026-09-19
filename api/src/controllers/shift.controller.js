const shiftService = require('../services/shift.service');

// Per-kasir cash-reconciliation accuracy is confidential between staff —
// admin sees it, a kasir doesn't even see it for their own past shifts once
// listed here. What stays visible either way: revenue/orderCount/byMetode
// (what was sold), never the "was this person's count right" signal.
function redactCash(shift) {
  const { cashCounted, expectedCash, cashDifference, isMinus, ...rest } = shift;
  return rest;
}

async function start(req, res) {
  const shift = await shiftService.startShift(req.session.user.id);
  res.status(201).json({ shift });
}

async function end(req, res) {
  const shift = await shiftService.endShift(req.session.user.id, req.body.cashCounted);
  res.json({ shift });
}

async function active(req, res) {
  const shift = await shiftService.getMyActiveShift(req.session.user.id);
  res.json({ shift });
}

async function list(req, res) {
  const shifts = await shiftService.listShifts(req.query.limit);
  const isAdmin = req.session.user.role === 'admin';
  res.json({ shifts: isAdmin ? shifts : shifts.map(redactCash) });
}

async function detail(req, res) {
  const shift = await shiftService.getShiftDetail(req.params.id);
  res.json({ shift });
}

module.exports = { start, end, active, list, detail };
