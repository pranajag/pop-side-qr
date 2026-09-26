const settingsService = require('../services/settings.service');
const shiftService = require('../services/shift.service');

async function get(req, res) {
  const [settings, pinVerifikasiMinimal] = await Promise.all([
    settingsService.getSettings(),
    settingsService.getPinVerifikasiMinimal(),
  ]);
  // Hanya di GET admin ini — toShaped() yang dikirim ke publik tidak memuatnya.
  res.json({ settings: { ...settings, pinVerifikasiMinimal } });
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

async function updateMemberEnabled(req, res) {
  const settings = await settingsService.updateStoreInfo({
    memberEnabled: req.body.memberEnabled,
  });
  res.json({ settings });
}

async function updateAturanDp(req, res) {
  const aturanDp = await settingsService.updateAturanDp(req.body);
  res.json({ aturanDp });
}

async function updatePinVerifikasi(req, res) {
  res.json({ pinVerifikasi: await settingsService.updatePinVerifikasi(req.body.minimal) });
}

module.exports = { get, getPublic, updateQris, updateStoreInfo, updateMemberEnabled, updateAturanDp, updatePinVerifikasi };
