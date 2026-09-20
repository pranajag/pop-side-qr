const dashboardService = require('../services/dashboard.service');

async function get(req, res) {
  const overview = await dashboardService.getOverview();
  res.json({ overview });
}

module.exports = { get };
