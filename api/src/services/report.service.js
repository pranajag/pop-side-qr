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

  const orders = await prisma.order.findMany({
    where,
    select: { metode: true, totalHarga: true, discountAmount: true },
  });
  const { byMetode, total } = sumByMetode(orders);
  // Informational only, for the accounting export below — totalHarga above
  // is already net of any discount, so this is never subtracted from
  // `total` again (that would double-count it).
  const totalDiscount = orders.reduce((sum, o) => sum + (o.discountAmount === null ? 0 : Number(o.discountAmount)), 0);

  // Grouped by productId (stable), displayed with the product's *current*
  // name — same convention every other order-shaping function in this
  // codebase already uses (name is read live via the relation, only price
  // is ever snapshotted onto the order row).
  const items = await prisma.orderItem.findMany({
    where: { order: where },
    select: {
      qty: true,
      hargaSaatOrder: true,
      productId: true,
      product: { select: { nama: true, hargaModal: true } },
    },
  });
  const byProduct = new Map();
  for (const item of items) {
    const entry = byProduct.get(item.productId) ?? {
      nama: item.product.nama,
      qty: 0,
      revenue: 0,
      // null = this product has no hargaModal set — margin for it (and
      // therefore for any total that includes it) is genuinely unknown,
      // not zero. Sticks at null the moment one line hits it, since a
      // product's cost price can't retroactively un-become "unset" partway
      // through summing its own lines.
      margin: item.product.hargaModal === null ? null : 0,
    };
    entry.qty += item.qty;
    entry.revenue += Number(item.hargaSaatOrder) * item.qty;
    if (entry.margin !== null && item.product.hargaModal !== null) {
      entry.margin += (Number(item.hargaSaatOrder) - Number(item.product.hargaModal)) * item.qty;
    } else {
      entry.margin = null;
    }
    byProduct.set(item.productId, entry);
  }
  const topProducts = [...byProduct.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);

  // Store-wide margin is only meaningful as "total across products that
  // actually have a cost price set" — silently treating an unset
  // hargaModal as 0 would inflate margin (100% profit on that product),
  // silently treating it as equal to the sale price would hide real
  // profit. knownMarginRevenue lets the UI show what fraction of revenue
  // the margin figure actually covers, instead of presenting a number that
  // looks complete but isn't.
  let totalMargin = 0;
  let knownMarginRevenue = 0;
  for (const entry of byProduct.values()) {
    if (entry.margin !== null) {
      totalMargin += entry.margin;
      knownMarginRevenue += entry.revenue;
    }
  }

  return {
    from: fromStr || jakartaDateISO(),
    to: toStr || jakartaDateISO(),
    total,
    orderCount: orders.length,
    byMetode,
    totalDiscount,
    topProducts,
    totalMargin,
    knownMarginRevenue,
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
