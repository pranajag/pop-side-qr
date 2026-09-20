const prisma = require('../lib/prisma');
const reportService = require('./report.service');
const shiftService = require('./shift.service');
const { jakartaDateISO, jakartaDayBoundsUTC } = require('../utils/jakartaTime');

// A "void" (as OrdersView.vue's own copy already calls it, and the only
// case requireAuth gates behind a PIN) is specifically a cancel of an
// already-PAID order — not any cancelled order. A pending/waiting_verif
// order cancelled before ever being confirmed never collected money, so it
// isn't a void and doesn't belong in this count. Order itself only stores
// its current status, not what it was cancelled FROM, so this has to read
// the transition out of OrderStatusLog instead of querying Order directly.
const PAID_STATUSES = ['confirmed', 'cooking', 'ready'];

async function countTodayVoids(dayBounds) {
  const logs = await prisma.orderStatusLog.findMany({
    where: {
      statusTo: 'cancelled',
      statusFrom: { in: PAID_STATUSES },
      createdAt: { gte: dayBounds.start, lt: dayBounds.end },
    },
    select: { orderId: true },
  });
  if (logs.length === 0) return { count: 0, totalAmount: 0 };

  const orders = await prisma.order.findMany({
    where: { id: { in: logs.map((l) => l.orderId) } },
    select: { totalHarga: true },
  });
  return {
    count: orders.length,
    totalAmount: orders.reduce((sum, o) => sum + Number(o.totalHarga), 0),
  };
}

// Admin's landing page (router's beforeEach) — the "how's today going"
// snapshot that was previously nowhere in the app; admins had to open
// Laporan and pick a date range just to see today's number. Reuses
// report.service.js's own revenue rule (REVENUE_STATUSES) and math
// entirely rather than recomputing it a second way here.
async function getOverview() {
  const today = jakartaDateISO();
  const yesterday = jakartaDateISO(new Date(Date.now() - 24 * 60 * 60 * 1000));

  const [todayReport, yesterdayReport, pendingVerifCount, activeShifts, todayVoids] = await Promise.all([
    reportService.getReport(today, today),
    reportService.getReport(yesterday, yesterday),
    // Same status this dashboard's "butuh perhatian" count is named for —
    // QRIS orders sitting with an uploaded bukti bayar, waiting on a kasir
    // to match it against a real mutation and confirm (OrdersView.vue).
    prisma.order.count({ where: { status: 'waiting_verif' } }),
    shiftService.listActiveShifts(),
    countTodayVoids(jakartaDayBoundsUTC()),
  ]);

  return {
    today: {
      total: todayReport.total,
      orderCount: todayReport.orderCount,
      byMetode: todayReport.byMetode,
      // Top 5, not the report page's full top 10 — this is a glance, not
      // an analysis; ReportView.vue is still where someone digs deeper.
      topProducts: todayReport.topProducts.slice(0, 5),
      voidCount: todayVoids.count,
      voidAmount: todayVoids.totalAmount,
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
