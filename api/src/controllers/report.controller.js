const reportService = require('../services/report.service');
const reportExport = require('../services/reportExport.service');

async function get(req, res) {
  const report = await reportService.getReport(req.query.from, req.query.to);
  res.json({ report });
}

async function dailyBreakdown(req, res) {
  const days = await reportService.getDailyBreakdown(req.query.from, req.query.to);
  res.json({ days });
}

async function exportExcel(req, res) {
  const buffer = await reportExport.generateExcel(req.query.from, req.query.to);
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="laporan-popside_${req.query.from}_${req.query.to}.xlsx"`);
  res.send(buffer);
}

async function exportJournalExcel(req, res) {
  const buffer = await reportExport.generateJournalExcel(req.query.from, req.query.to);
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="jurnal-popside_${req.query.from}_${req.query.to}.xlsx"`);
  res.send(buffer);
}

module.exports = { get, dailyBreakdown, exportExcel, exportJournalExcel };
