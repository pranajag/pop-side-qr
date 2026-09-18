const reportService = require('../services/report.service');

async function get(req, res) {
  const report = await reportService.getReport(req.query.from, req.query.to);
  res.json({ report });
}

module.exports = { get };
