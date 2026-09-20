const prisma = require('../lib/prisma');
const reportService = require('./report.service');
const shiftService = require('./shift.service');
const { jakartaDateISO } = require('../utils/jakartaTime');

// Admin's landing page (router's beforeEach) — the "how's today going"
// snapshot that was previously nowhere in the app; admins had to open
// Laporan and pick a date range just to see today's number. Reuses
// report.service.js's own revenue rule (REVENUE_STATUSES) and math
// entirely rather than recomputing it a second way here.
async function getOverview() {
  const today = jakartaDateISO();
  const yesterday = jakartaDateISO(new Date(Date.now() - 24 * 60 * 60 * 1000));

  const [todayReport, yesterdayReport, pendingVerifCount, activeShifts] = await Promise.all([
    reportService.getReport(today, today),
    reportService.getReport(yesterday, yesterday),
    // Same status this dashboard's "butuh perhatian" count is named for —
    // QRIS orders sitting with an uploaded bukti bayar, waiting on a kasir
    // to match it against a real mutation and confirm (OrdersView.vue).
    prisma.order.count({ where: { status: 'waiting_verif' } }),
    shiftService.listActiveShifts(),
  ]);

  return {
    today: {
      total: todayReport.total,
      orderCount: todayReport.orderCount,
      byMetode: todayReport.byMetode,
      // Top 5, not the report page's full top 10 — this is a glance, not
      // an analysis; ReportView.vue is still where someone digs deeper.
      topProducts: todayReport.topProducts.slice(0, 5),
    },
    yesterday: {
      total: yesterdayReport.total,
      orderCount: yesterdayReport.orderCount,
    },
    pendingVerifCount,
    activeShifts,
  };
}

module.exports = { getOverview };
