const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const paymentProof = require('./paymentProof.service');
const userService = require('./user.service');
const customerService = require('./customer.service');
const webhookService = require('./webhook.service');

const STATUS_PRIORITY = {
  waiting_verif: 0,
  pending: 1,
  confirmed: 2,
  cooking: 3,
  ready: 4,
  completed: 5,
  cancelled: 6,
};

// Linear kitchen progression. Cancellation is handled separately (allowed
// from any non-terminal state, per MEMORY.md).
const NEXT_STATUS = {
  confirmed: 'cooking',
  cooking: 'ready',
  ready: 'completed',
};
const CANCELLABLE_FROM = new Set(['pending', 'waiting_verif', 'confirmed', 'cooking', 'ready']);
// Past the payment gate — cancelling one of these is a "void" (money
// already changed hands), same distinction admin-web's OrdersView.vue
// already draws in its own copy/dialog. A void requires the acting staff's
// own PIN; a plain pre-payment cancel doesn't.
const PAID_STATUSES = new Set(['confirmed', 'cooking', 'ready']);

const ORDER_INCLUDE = {
  table: { select: { nomorMeja: true } },
  items: { include: { product: { select: { nama: true } }, variants: true } },
  payment: { select: { buktiFile: true, verifiedAt: true } },
};

function shapeOrder(order) {
  return {
    id: order.id,
    kodeOrder: order.kodeOrder,
    status: order.status,
    metode: order.metode,
    totalHarga: Number(order.totalHarga),
    // QRIS-only reconciliation code (order.service.js's pickUniqueCode) —
    // OrdersView.vue shows totalHarga + uniqueCode next to the uploaded
    // bukti bayar so kasir can match that exact figure against their real
    // bank/e-wallet mutation instead of trusting the screenshot alone.
    uniqueCode: order.uniqueCode,
    discountAmount: order.discountAmount === null ? 0 : Number(order.discountAmount),
    discountReason: order.discountReason,
    taxAmount: Number(order.taxAmount),
    serviceChargeAmount: Number(order.serviceChargeAmount),
    catatan: order.catatan,
    refundAmount: order.refundAmount === null ? null : Number(order.refundAmount),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    nomorMeja: order.table?.nomorMeja ?? null,
    customerName: order.customerName,
    pointsEarned: order.pointsEarned ?? 0,
    // Never the filename itself — that's only ever resolved server-side
    // by serveBuktiBayar, keyed off this order's own id, never handed to
    // the client to construct a URL from directly.
    hasBuktiBayar: !!order.payment?.buktiFile,
    items: order.items.map((item) => ({
      nama: item.product.nama,
      qty: item.qty,
      harga: Number(item.hargaSaatOrder),
      catatan: item.catatan,
      variants: item.variants.map((v) => ({ namaGroup: v.namaGroup, namaOption: v.namaOption })),
    })),
  };
}

const VALID_STATUSES = new Set(Object.keys(STATUS_PRIORITY));

function buildWhere(statusFilter) {
  if (statusFilter === 'all' || statusFilter === undefined) {
    return statusFilter === 'all' ? {} : { status: { notIn: ['completed', 'cancelled'] } };
  }
  if (!VALID_STATUSES.has(statusFilter)) {
    throw new AppError(400, 'Status filter tidak valid');
  }
  return { status: statusFilter };
}

async function list(statusFilter) {
  const orders = await prisma.order.findMany({ where: buildWhere(statusFilter), include: ORDER_INCLUDE });
  return orders
    .sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] || a.createdAt - b.createdAt)
    .map(shapeOrder);
}

// For external.routes.js's polling endpoint — "everything touched since I
// last checked", ordered oldest-first so a client that processes
// sequentially and records the last updatedAt it saw can resume exactly
// where it left off, even if it's paginating in fixed-size pages.
async function listSince(since, limit) {
  const orders = await prisma.order.findMany({
    where: { updatedAt: { gte: since } },
    include: ORDER_INCLUDE,
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });
  return orders.map(shapeOrder);
}

async function findFull(tx, id) {
  return tx.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
}

// QRIS orders are confirmed from waiting_verif (customer already clicked
// "sudah bayar"); tunai/debit are confirmed straight from pending (no
// customer-side step for those methods) — see MEMORY.md's status table.
async function confirmPayment(orderId, userId) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new AppError(404, 'Order tidak ditemukan');
  }

  const expectedStatus = order.metode === 'qris' ? 'waiting_verif' : 'pending';
  if (order.status !== expectedStatus) {
    throw new AppError(409, `Order berstatus "${order.status}", tidak bisa dikonfirmasi dari sini.`);
  }

  const shaped = await prisma.$transaction(async (tx) => {
    // Optimistic lock — two kasir confirming the same order at once only
    // lets one UPDATE actually match a row.
    const result = await tx.order.updateMany({
      where: { id: orderId, status: expectedStatus },
      data: { status: 'confirmed' },
    });
    if (result.count === 0) {
      throw new AppError(409, 'Order ini sudah diproses staff lain.');
    }

    // Member points (public checkout's own phone opt-in — order.service.js's
    // createOrder) were only ever snapshotted at creation, never credited —
    // an order that never gets this far (cancelled, abandoned QRIS) must
    // never have paid out points for a sale that didn't happen. This is the
    // actual "was paid" moment, symmetric with updateStatus's void path
    // clawing the same snapshot back out via reversePoints.
    if (order.customerId && order.pointsEarned > 0) {
      await customerService.awardPoints(tx, order.customerId, order.pointsEarned);
    }

    await tx.orderStatusLog.create({
      data: { orderId, statusFrom: expectedStatus, statusTo: 'confirmed', changedBy: userId },
    });

    return shapeOrder(await findFull(tx, orderId));
  });
  webhookService.dispatch('order.status_changed', {
    kodeOrder: shaped.kodeOrder,
    statusFrom: expectedStatus,
    statusTo: 'confirmed',
  });
  return shaped;
}

async function updateStatus(orderId, newStatus, userId, catatan, refundAmount, pin) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) {
    throw new AppError(404, 'Order tidak ditemukan');
  }

  const currentStatus = order.status;
  if (newStatus === 'cancelled') {
    if (!CANCELLABLE_FROM.has(currentStatus)) {
      throw new AppError(409, `Order berstatus "${currentStatus}" tidak bisa dibatalkan.`);
    }
    if (PAID_STATUSES.has(currentStatus)) {
      await userService.verifyPin(userId, pin);
    }
  } else if (NEXT_STATUS[currentStatus] !== newStatus) {
    throw new AppError(400, `Tidak bisa mengubah status dari "${currentStatus}" ke "${newStatus}".`);
  }

  const shaped = await prisma.$transaction(async (tx) => {
    const result = await tx.order.updateMany({
      where: { id: orderId, status: currentStatus },
      // refundAmount is only ever meaningful on a cancel, and undefined on
      // every other transition — Prisma skips an undefined field entirely,
      // so this never clobbers refundAmount on non-cancel updates.
      data: { status: newStatus, refundAmount: newStatus === 'cancelled' ? refundAmount : undefined },
    });
    if (result.count === 0) {
      throw new AppError(409, 'Status order sudah berubah, muat ulang dulu.');
    }

    if (newStatus === 'cancelled') {
      // Stock was reserved at order creation (Sprint 4) — give it back so
      // a cancelled order doesn't permanently shrink availability. Uses
      // each item's own stockDecremented snapshot, not the product's
      // *current* trackStock — an admin can flip that flag after the
      // order was placed, which would otherwise restore stock that was
      // never taken (or skip restoring stock that was).
      const toRestore = order.items.filter((item) => item.stockDecremented);
      if (toRestore.length > 0) {
        await Promise.all(
          toRestore.map((item) =>
            tx.product.update({ where: { id: item.productId }, data: { stok: { increment: item.qty } } })
          )
        );
      }
      // Symmetric with awarding them at confirmPayment (not at creation —
      // a public order's points are only snapshotted then, credited later,
      // see order.service.js's createOrder) — a voided order never
      // happened, so any points it credited shouldn't still be sitting in
      // the member's balance. Gated on PAID_STATUSES, same set
      // requireAuth's PIN check above already uses to mean "money already
      // changed hands": a pending/waiting_verif order cancelled before
      // ever being confirmed never actually credited its snapshotted
      // pointsEarned in the first place (confirmPayment is what credits
      // it), so reversing here would wrongly dock points the member never
      // received.
      if (PAID_STATUSES.has(currentStatus) && order.customerId && order.pointsEarned > 0) {
        await customerService.reversePoints(tx, order.customerId, order.pointsEarned);
      }
    }

    await tx.orderStatusLog.create({
      data: { orderId, statusFrom: currentStatus, statusTo: newStatus, changedBy: userId, catatan },
    });

    return shapeOrder(await findFull(tx, orderId));
  });
  webhookService.dispatch('order.status_changed', {
    kodeOrder: shaped.kodeOrder,
    statusFrom: currentStatus,
    statusTo: newStatus,
  });
  return shaped;
}

// Filename is looked up here, from this authenticated+role-gated call,
// never accepted from the client — that's what keeps bukti bayar private
// despite being served over HTTP (no public route ever exposes its name).
async function serveBuktiBayar(orderId, res, next) {
  const payment = await prisma.payment.findUnique({ where: { orderId }, select: { buktiFile: true } });
  if (!payment?.buktiFile) {
    return next(new AppError(404, 'Bukti pembayaran tidak ada'));
  }
  paymentProof.serveFile(payment.buktiFile, res, next);
}

// Surfaces the audit trail every status transition already writes (both
// staff-driven changes and the customer's own "sudah bayar" click) — no
// new tracking needed, just reading data this system has captured since
// Sprint 1 but never shown anyone. changedBy is null for the one
// customer-triggered transition (pending -> waiting_verif), and for any
// order cancelled by the public "batal" flow.
async function listActivity(limit) {
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const logs = await prisma.orderStatusLog.findMany({
    take: capped,
    orderBy: { id: 'desc' },
    include: {
      order: { select: { kodeOrder: true, customerName: true, table: { select: { nomorMeja: true } } } },
      changedByUser: { select: { username: true, role: true } },
    },
  });
  return logs.map((log) => ({
    id: log.id,
    orderId: log.orderId,
    kodeOrder: log.order.kodeOrder,
    nomorMeja: log.order.table?.nomorMeja ?? null,
    customerName: log.order.customerName,
    statusFrom: log.statusFrom,
    statusTo: log.statusTo,
    changedBy: log.changedByUser?.username ?? null,
    changedByRole: log.changedByUser?.role ?? null,
    catatan: log.catatan,
    createdAt: log.createdAt,
  }));
}

module.exports = { list, listSince, confirmPayment, updateStatus, serveBuktiBayar, listActivity };
