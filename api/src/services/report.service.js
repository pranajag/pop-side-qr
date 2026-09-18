const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { jakartaDayBoundsUTC, jakartaDateISO } = require('../utils/jakartaTime');

// Confirmed by user: revenue counts from the moment a kasir confirms
// payment onward (not just fully `completed`) — pending/waiting_verif
// (not yet paid) and cancelled never count, per MEMORY.md.
const REVENUE_STATUSES = ['confirmed', 'cooking', 'ready', 'completed'];

// A sane cap (~a quarter) so a typo'd year-wide range doesn't scan the
// whole orders table — this is an admin report, not a data export tool.
const MAX_RANGE_DAYS = 92;

// from/to both default to today (jakartaDayBoundsUTC's own default) when
// omitted, so calling this with neither param still gives the old
// single-day-report behavior for free.
async function getReport(fromStr, toStr) {
  const fromBounds = jakartaDayBoundsUTC(fromStr);
  const toBounds = jakartaDayBoundsUTC(toStr);
  if (!fromBounds || !toBounds) {
    throw new AppError(400, 'Format tanggal harus YYYY-MM-DD');
  }
  if (fromBounds.start > toBounds.start) {
    throw new AppError(400, 'Tanggal awal harus sebelum atau sama dengan tanggal akhir');
  }
  const rangeDays = Math.round((toBounds.start - fromBounds.start) / 86400000) + 1;
  if (rangeDays > MAX_RANGE_DAYS) {
    throw new AppError(400, `Rentang tanggal maksimal ${MAX_RANGE_DAYS} hari`);
  }

  const where = {
    createdAt: { gte: fromBounds.start, lt: toBounds.end },
    status: { in: REVENUE_STATUSES },
  };

  const orders = await prisma.order.findMany({ where, select: { metode: true, totalHarga: true } });
  const { byMetode, total } = sumByMetode(orders);

  // Grouped by productId (stable), displayed with the product's *current*
  // name — same convention every other order-shaping function in this
  // codebase already uses (name is read live via the relation, only price
  // is ever snapshotted onto the order row).
  const items = await prisma.orderItem.findMany({
    where: { order: where },
    select: { qty: true, hargaSaatOrder: true, productId: true, product: { select: { nama: true } } },
  });
  const byProduct = new Map();
  for (const item of items) {
    const entry = byProduct.get(item.productId) ?? { nama: item.product.nama, qty: 0, revenue: 0 };
    entry.qty += item.qty;
    entry.revenue += Number(item.hargaSaatOrder) * item.qty;
    byProduct.set(item.productId, entry);
  }
  const topProducts = [...byProduct.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);

  return {
    from: fromStr || jakartaDateISO(),
    to: toStr || jakartaDateISO(),
    total,
    orderCount: orders.length,
    byMetode,
    topProducts,
  };
}

// Shared with shift.service.js's cash-reconciliation calc — same "how much
// revenue, split by payment method" question, just windowed differently.
function sumByMetode(orders) {
  const byMetode = { qris: 0, tunai: 0, debit: 0 };
  let total = 0;
  for (const order of orders) {
    const amount = Number(order.totalHarga);
    byMetode[order.metode] += amount;
    total += amount;
  }
  return { byMetode, total };
}

module.exports = { getReport, REVENUE_STATUSES, sumByMetode };
