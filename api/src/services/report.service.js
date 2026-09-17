const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { jakartaDayBoundsUTC, jakartaDateISO } = require('../utils/jakartaTime');

// Confirmed by user: revenue counts from the moment a kasir confirms
// payment onward (not just fully `completed`) — pending/waiting_verif
// (not yet paid) and cancelled never count, per MEMORY.md.
const REVENUE_STATUSES = ['confirmed', 'cooking', 'ready', 'completed'];

async function getDailyReport(dateStr) {
  const bounds = jakartaDayBoundsUTC(dateStr);
  if (!bounds) {
    throw new AppError(400, 'Format tanggal harus YYYY-MM-DD');
  }

  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: bounds.start, lt: bounds.end },
      status: { in: REVENUE_STATUSES },
    },
    select: { metode: true, totalHarga: true },
  });

  const byMetode = { qris: 0, tunai: 0, debit: 0 };
  let total = 0;
  for (const order of orders) {
    const amount = Number(order.totalHarga);
    byMetode[order.metode] += amount;
    total += amount;
  }

  return {
    date: dateStr || jakartaDateISO(),
    total,
    orderCount: orders.length,
    byMetode,
  };
}

module.exports = { getDailyReport };
