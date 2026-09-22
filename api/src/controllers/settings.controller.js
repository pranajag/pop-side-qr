const settingsService = require('../services/settings.service');
const shiftService = require('../services/shift.service');

async function get(req, res) {
  const settings = await settingsService.getSettings();
  res.json({ settings });
}

// Public variant: same store info, plus whether the cafe is actually open
// for orders right now (any staff clocked in). public-web already loads
// this on startup, so the closed state costs no extra round trip — and the
// customer learns the kitchen is closed on the menu screen rather than
// after building a whole cart. order.service.js enforces it for real.
async function getPublic(req, res) {
  const [settings, sedangBuka] = await Promise.all([
    settingsService.getSettings(),
    shiftService.isAnyShiftActive(),
  ]);
  res.json({ settings, sedangBuka });
}

async function updateQris(req, res) {
  const settings = await settingsService.updateQrisImage(req.file?.buffer);
  res.json({ settings });
}

async function updateStoreInfo(req, res) {
  const settings = await settingsService.updateStoreInfo(req.body);
  res.json({ settings });
}

module.exports = { get, getPublic, updateQris, updateStoreInfo };
