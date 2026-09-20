const crypto = require('crypto');
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { generateOrderCode } = require('../utils/orderCode');
const { isUniqueConstraintError } = require('../utils/prismaErrors');
const { resolveProductVariants } = require('../utils/productVariants');
const { jakartaDayBoundsUTC } = require('../utils/jakartaTime');
const tableService = require('./table.service');
const paymentProof = require('./paymentProof.service');
const customerService = require('./customer.service');
const webhookService = require('./webhook.service');

const MAX_CODE_ATTEMPTS = 5;
// Adds Rp1-499 on top of totalHarga for QRIS orders — small enough to still
// visually read as "the same total", large enough that two unrelated
// pending orders landing on the exact same final rupiah by chance is rare
// (and pickUniqueCode below actively avoids it anyway).
const UNIQUE_CODE_MAX = 500;
const KODE_ORDER_PATTERN = /^ORD-\d{8}-[A-Z0-9]{4}$/;
// Anything not yet completed/cancelled — used to decide whether a table is
// still "occupied" by whoever placed its most recent order (see
// bumpVisitIfTableIsFree below).
const NON_TERMINAL_STATUSES = ['pending', 'waiting_verif', 'confirmed', 'cooking', 'ready'];

// A table's "visit" is the run of orders from one seating, with no schema
// concept of its own — approximated here as "since the last time this table
// had zero non-terminal orders". Bumping it right before a genuinely new
// visit's first order (not on every order) means a group ordering food in
// several rounds never gets split into multiple "visits" just because an
// earlier round of theirs already finished — only a table that was fully
// clear starts fresh. order.service.js's getTableBill uses this as the
// lower bound for "what should show up on this table's bill right now",
// so a new group never sees a previous group's orders mixed in.
async function bumpVisitIfTableIsFree(tx, tableId) {
  const hasActiveOrder = await tx.order.findFirst({
    where: { tableId, status: { in: NON_TERMINAL_STATUSES } },
    select: { id: true },
  });
  if (!hasActiveOrder) {
    await tx.table.update({ where: { id: tableId }, data: { currentVisitStartedAt: new Date() } });
  }
}

// Shared by both createOrder (public QR checkout) and createManualOrder
// (staff-entered counter/takeaway sale) — same stock/variant/pricing rules
// either way, only who's placing the order and what happens to status
// after differ.
async function buildOrderItems(tx, items) {
  // One batched read for the initial availability/price snapshot (matches
  // cart.service.js's computeTotal) — safe to batch because it's read-only
  // and happens entirely before any decrement; the atomic updateMany below
  // still independently re-checks stock at decrement time regardless of
  // what this batch saw.
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    include: { variantGroups: { include: { options: true } } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  let totalHarga = 0;
  const orderItemsData = [];

  for (const item of items) {
    const product = productById.get(item.productId);
    if (!product || !product.isAvailable) {
      throw new AppError(400, `${product?.nama ?? 'Produk'} sudah tidak tersedia`);
    }

    const resolved = resolveProductVariants(product, item.variantOptionIds);
    if (resolved.error) {
      throw new AppError(400, resolved.error);
    }

    if (product.trackStock) {
      // Atomic check-and-decrement: the WHERE clause and the write happen
      // as one statement, so two concurrent orders for the last unit can't
      // both read stok=1 and both succeed — the second one's UPDATE simply
      // matches zero rows.
      const result = await tx.product.updateMany({
        where: { id: product.id, stok: { gte: item.qty } },
        data: { stok: { decrement: item.qty } },
      });
      if (result.count === 0) {
        throw new AppError(409, `Stok ${product.nama} tidak cukup`);
      }
    }

    const harga = Number(product.harga) + resolved.extraPerUnit;
    totalHarga += harga * item.qty;
    orderItemsData.push({
      productId: product.id,
      qty: item.qty,
      hargaSaatOrder: harga,
      // Snapshot, not re-derived later: whether stock was actually taken
      // for this line, independent of whatever trackStock is set to by the
      // time this order might get cancelled.
      stockDecremented: product.trackStock,
      catatan: item.catatan,
      variants: resolved.snapshots.length ? { create: resolved.snapshots } : undefined,
    });
  }

  return { orderItemsData, totalHarga };
}

// QRIS-only reconciliation trick (see schema.prisma's uniqueCode comment) —
// picks a code such that totalHarga + code doesn't collide with any OTHER
// order a kasir might currently be trying to match against a real bank/
// e-wallet mutation. That's every QRIS order not yet kasir-confirmed
// (pending: customer hasn't paid yet but might any second; waiting_verif:
// customer claims they paid, kasir hasn't confirmed yet) — once an order
// leaves that window its nominal is no longer "live" and the code is free
// to be reused by a later order.
async function pickUniqueCode(tx, totalHarga) {
  const live = await tx.order.findMany({
    where: { metode: 'qris', status: { in: ['pending', 'waiting_verif'] }, uniqueCode: { not: null } },
    select: { totalHarga: true, uniqueCode: true },
  });
  const taken = new Set(live.map((o) => Number(o.totalHarga) + o.uniqueCode));

  for (let attempt = 0; attempt < 30; attempt++) {
    const code = crypto.randomInt(1, UNIQUE_CODE_MAX);
    if (!taken.has(totalHarga + code)) {
      return code;
    }
  }
  // Would need ~30 simultaneous pending QRIS orders that all happen to
  // collide on this specific total — vanishingly unlikely for a single
  // cafe. Widened range as a last resort rather than failing the order.
  return UNIQUE_CODE_MAX + crypto.randomInt(1, UNIQUE_CODE_MAX);
}

async function createOrder({ token, metode, catatan, items, idempotencyKey }) {
  const table = await tableService.verifyToken(token);
  if (!table) {
    throw new AppError(404, 'Meja tidak valid. Coba scan ulang QR.');
  }

  // A retry (dropped connection, timeout, double-tap) resends the same
  // idempotencyKey — if the first attempt actually made it through, return
  // that order as-is instead of taking payment/stock twice for one tap.
  if (idempotencyKey) {
    const existing = await prisma.order.findUnique({ where: { idempotencyKey }, include: { items: true } });
    if (existing) return existing;
  }

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const kodeOrder = generateOrderCode();
    try {
      // Interactive transaction: every read+conditional-write below runs
      // in one DB transaction, so a thrown error (bad item, stock race
      // lost) rolls back everything — including stock already decremented
      // for earlier items in this same attempt.
      const created = await prisma.$transaction(async (tx) => {
        await bumpVisitIfTableIsFree(tx, table.id);
        const { orderItemsData, totalHarga } = await buildOrderItems(tx, items);
        const uniqueCode = metode === 'qris' ? await pickUniqueCode(tx, totalHarga) : null;
        return tx.order.create({
          data: {
            kodeOrder,
            tableId: table.id,
            status: 'pending',
            metode,
            totalHarga,
            uniqueCode,
            catatan,
            idempotencyKey: idempotencyKey ?? undefined,
            items: { create: orderItemsData },
            payment: { create: { metode, amount: totalHarga } },
          },
          include: { items: true },
        });
      });
      // After the transaction commits, never inside it — a webhook POST is
      // real network I/O that must not hold the DB transaction open, and
      // must never fire for a creation that then rolled back.
      webhookService.dispatch('order.created', { kodeOrder: created.kodeOrder, metode, totalHarga: Number(created.totalHarga), source: 'qr' });
      return created;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        // Two unique columns can fire here: kode_order (a same-day code
        // collision — retry with a fresh code) or idempotency_key (a
        // genuinely concurrent duplicate of this same request beat this
        // one to the insert — fetch and return ITS order rather than
        // retrying into a second real order for the same tap).
        if (idempotencyKey) {
          const raced = await prisma.order.findUnique({ where: { idempotencyKey }, include: { items: true } });
          if (raced) return raced;
        }
        continue;
      }
      throw err;
    }
  }

  throw new AppError(500, 'Gagal membuat kode order, coba lagi.');
}

// Staff-entered counter/takeaway sale — no table, created straight into
// 'confirmed' rather than the dine-in flow's pending -> waiting_verif ->
// confirmed. That multi-step exists because DIFFERENT people (customer,
// then kasir) act at different times on the public flow; here the kasir is
// the one both taking payment and entering the order in the same moment,
// so there's nothing to wait on. The status_log entry still records the
// jump for the same audit-trail reason every other transition is logged.
async function createManualOrder({
  customerName,
  metode,
  catatan,
  items,
  userId,
  discountAmount,
  discountReason,
  customerPhone,
}) {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const kodeOrder = generateOrderCode();
    try {
      const created = await prisma.$transaction(async (tx) => {
        const { orderItemsData, totalHarga: subtotal } = await buildOrderItems(tx, items);
        // Discount is staff-entered here only — createOrder (public
        // checkout) never accepts one, which would let a customer set
        // their own price. Capped at the subtotal so totalHarga can never
        // go negative; validator.js already requires discountReason
        // whenever discountAmount > 0, so this can't collect an
        // unexplained deduction.
        const discount = Math.min(discountAmount ?? 0, subtotal);
        const totalHarga = subtotal - discount;

        // Loyalty: optional, staff-entered here only (same reasoning as
        // discount above — the public QR flow doesn't collect a phone
        // number). Earns points on what was actually paid, post-discount.
        let customer = null;
        let pointsEarned = 0;
        if (customerPhone) {
          customer = await customerService.findOrCreateByPhone(tx, customerPhone, customerName);
          pointsEarned = customerService.pointsFor(totalHarga);
          await customerService.awardPoints(tx, customer.id, pointsEarned);
        }

        const order = await tx.order.create({
          data: {
            kodeOrder,
            tableId: null,
            customerName: customerName || null,
            customerId: customer?.id ?? null,
            pointsEarned,
            status: 'confirmed',
            metode,
            totalHarga,
            discountAmount: discount,
            discountReason: discount > 0 ? discountReason : null,
            catatan,
            items: { create: orderItemsData },
            payment: { create: { metode, amount: totalHarga } },
          },
          include: { items: true },
        });
        await tx.orderStatusLog.create({
          data: { orderId: order.id, statusFrom: 'pending', statusTo: 'confirmed', changedBy: userId },
        });
        return order;
      });
      webhookService.dispatch('order.created', {
        kodeOrder: created.kodeOrder,
        metode,
        totalHarga: Number(created.totalHarga),
        source: 'manual',
      });
      return created;
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        continue;
      }
      throw err;
    }
  }

  throw new AppError(500, 'Gagal membuat kode order, coba lagi.');
}

async function confirmQrisPayment(kodeOrder, fileBuffer) {
  if (!KODE_ORDER_PATTERN.test(kodeOrder)) {
    throw new AppError(404, 'Order tidak ditemukan');
  }

  const order = await prisma.order.findUnique({ where: { kodeOrder } });
  if (!order) {
    throw new AppError(404, 'Order tidak ditemukan');
  }
  if (order.metode !== 'qris') {
    throw new AppError(400, 'Order ini bukan pembayaran QRIS');
  }
  if (order.status !== 'pending') {
    throw new AppError(409, 'Order ini sudah diproses sebelumnya');
  }
  if (!fileBuffer) {
    throw new AppError(400, 'Bukti pembayaran wajib diupload');
  }

  // Uploaded before the transaction (matches product.service.js's
  // upload-then-write-then-cleanup-on-failure pattern) — saved with a
  // magic-byte check + random filename, never the client's own filename.
  const buktiFile = await paymentProof.save(fileBuffer);

  try {
    return await prisma.$transaction(async (tx) => {
      // Optimistic lock: only succeeds if status is still 'pending' at the
      // moment of the write, so a double-tap of "sudah bayar" can't log two
      // transitions for the same order.
      const updateResult = await tx.order.updateMany({
        where: { kodeOrder, status: 'pending' },
        data: { status: 'waiting_verif' },
      });
      if (updateResult.count === 0) {
        throw new AppError(409, 'Order ini sudah diproses sebelumnya');
      }

      await tx.payment.update({ where: { orderId: order.id }, data: { buktiFile } });

      // changedBy is null — this transition is customer-triggered, not staff.
      await tx.orderStatusLog.create({
        data: { orderId: order.id, statusFrom: 'pending', statusTo: 'waiting_verif', changedBy: null },
      });

      return tx.order.findUnique({ where: { kodeOrder } });
    });
  } catch (err) {
    await paymentProof.remove(buktiFile);
    throw err;
  }
}

async function getByCode(kodeOrder) {
  if (!KODE_ORDER_PATTERN.test(kodeOrder)) {
    throw new AppError(404, 'Order tidak ditemukan');
  }

  const order = await prisma.order.findUnique({
    where: { kodeOrder },
    include: {
      items: {
        include: { product: { select: { nama: true, category: { select: { estimasiMenit: true } } } }, variants: true },
      },
      table: { select: { nomorMeja: true } },
    },
  });
  if (!order) {
    throw new AppError(404, 'Order tidak ditemukan');
  }

  // Slowest category among the items wins — the order isn't "ready" until
  // everything on it is, and this app has no real per-item kitchen timing
  // to do better than that. null when no category on the order has an
  // estimate set, so the customer sees nothing instead of a made-up number.
  const estimates = order.items.map((item) => item.product.category.estimasiMenit).filter((m) => m !== null);
  const estimasiMenit = estimates.length > 0 ? Math.max(...estimates) : null;

  return {
    kodeOrder: order.kodeOrder,
    status: order.status,
    metode: order.metode,
    totalHarga: Number(order.totalHarga),
    discountAmount: order.discountAmount === null ? 0 : Number(order.discountAmount),
    discountReason: order.discountReason,
    // Only ever set for QRIS — the exact rupiah the customer must transfer
    // is totalHarga + uniqueCode (frontend's job to add them; kept separate
    // here since totalHarga alone is still the real menu total everywhere
    // else — receipts, reports, tracking-page order summary).
    uniqueCode: order.uniqueCode,
    catatan: order.catatan,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    nomorMeja: order.table?.nomorMeja ?? null,
    customerName: order.customerName,
    estimasiMenit,
    items: order.items.map((item) => ({
      nama: item.product.nama,
      qty: item.qty,
      harga: Number(item.hargaSaatOrder),
      catatan: item.catatan,
      variants: item.variants.map((v) => ({ namaGroup: v.namaGroup, namaOption: v.namaOption })),
    })),
  };
}

// Combined bill for a table's current visit — this is a pay-as-you-go
// system (each order is paid individually, at ordering time, not at the
// end), so this doesn't collect a debt; it's a running summary for a table
// where several phones scan the same QR and order separately, so no single
// device's own order history shows what the whole table has spent. Scoped
// to today (Asia/Jakarta) since a table gets reused indefinitely and there's
// no visit/session concept in the schema — "today's orders on this table"
// is the closest available proxy for "this visit".
async function getTableBill(token) {
  const table = await tableService.verifyToken(token);
  if (!table) {
    throw new AppError(404, 'Meja tidak valid. Coba scan ulang QR.');
  }

  // Lower bound is the table's current visit (see bumpVisitIfTableIsFree),
  // not just "today" — a table reused for a new group later the same day
  // must never show the previous group's orders on this bill. Falls back to
  // today's start for a table that predates this field (never bumped yet).
  const visitStart = table.currentVisitStartedAt ?? jakartaDayBoundsUTC().start;
  const orders = await prisma.order.findMany({
    where: {
      tableId: table.id,
      status: { not: 'cancelled' },
      createdAt: { gte: visitStart },
    },
    include: { items: { include: { product: { select: { nama: true } } } } },
    orderBy: { createdAt: 'asc' },
  });

  const shaped = orders.map((order) => ({
    kodeOrder: order.kodeOrder,
    status: order.status,
    metode: order.metode,
    totalHarga: Number(order.totalHarga),
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      nama: item.product.nama,
      qty: item.qty,
      harga: Number(item.hargaSaatOrder),
    })),
  }));
  const total = shaped.reduce((sum, o) => sum + o.totalHarga, 0);

  return { nomorMeja: table.nomorMeja, orders: shaped, total };
}

module.exports = { createOrder, createManualOrder, confirmQrisPayment, getByCode, getTableBill };
