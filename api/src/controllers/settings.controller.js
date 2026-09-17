const settingsService = require('../services/settings.service');

async function get(req, res) {
  const settings = await settingsService.getSettings();
  res.json({ settings });
}

async function updateQris(req, res) {
  const settings = await settingsService.updateQrisImage(req.file?.buffer);
  res.json({ settings });
}

module.exports = { get, updateQris };
