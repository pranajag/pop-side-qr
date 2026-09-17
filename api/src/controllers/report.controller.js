const reportService = require('../services/report.service');

async function daily(req, res) {
  const report = await reportService.getDailyReport(req.query.date);
  res.json({ report });
}

module.exports = { daily };
