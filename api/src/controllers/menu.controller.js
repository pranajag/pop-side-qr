const menuService = require('../services/menu.service');

async function getMenu(req, res) {
  const categories = await menuService.getPublicMenu();
  res.json({ categories });
}

module.exports = { getMenu };
