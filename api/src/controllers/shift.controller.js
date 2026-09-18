const shiftService = require('../services/shift.service');

async function start(req, res) {
  const shift = await shiftService.startShift(req.session.user.id);
  res.status(201).json({ shift });
}

async function end(req, res) {
  const shift = await shiftService.endShift(req.session.user.id);
  res.json({ shift });
}

async function active(req, res) {
  const shift = await shiftService.getMyActiveShift(req.session.user.id);
  res.json({ shift });
}

async function list(req, res) {
  const shifts = await shiftService.listShifts(req.query.limit);
  res.json({ shifts });
}

module.exports = { start, end, active, list };
