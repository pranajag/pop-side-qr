const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');

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

const ORDER_INCLUDE = {
  table: { select: { nomorMeja: true } },
  items: { include: { product: { select: { nama: true } } } },
};

function shapeOrder(order) {
  return {
    id: order.id,
    kodeOrder: order.kodeOrder,
    status: order.status,
    metode: order.metode,
    totalHarga: Number(order.totalHarga),
    catatan: order.catatan,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    nomorMeja: order.table.nomorMeja,
    items: order.items.map((item) => ({
      nama: item.product.nama,
      qty: item.qty,
      harga: Number(item.hargaSaatOrder),
      catatan: item.catatan,
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

  return prisma.$transaction(async (tx) => {
    // Optimistic lock — two kasir confirming the same order at once only
    // lets one UPDATE actually match a row.
    const result = await tx.order.updateMany({
      where: { id: orderId, status: expectedStatus },
      data: { status: 'confirmed' },
    });
    if (result.count === 0) {
      throw new AppError(409, 'Order ini sudah diproses staff lain.');
    }

    await tx.orderStatusLog.create({
      data: { orderId, statusFrom: expectedStatus, statusTo: 'confirmed', changedBy: userId },
    });

    return shapeOrder(await findFull(tx, orderId));
  });
}

async function updateStatus(orderId, newStatus, userId, catatan) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) {
    throw new AppError(404, 'Order tidak ditemukan');
  }

  const currentStatus = order.status;
  if (newStatus === 'cancelled') {
    if (!CANCELLABLE_FROM.has(currentStatus)) {
      throw new AppError(409, `Order berstatus "${currentStatus}" tidak bisa dibatalkan.`);
    }
  } else if (NEXT_STATUS[currentStatus] !== newStatus) {
    throw new AppError(400, `Tidak bisa mengubah status dari "${currentStatus}" ke "${newStatus}".`);
  }

  return prisma.$transaction(async (tx) => {
    const result = await tx.order.updateMany({
      where: { id: orderId, status: currentStatus },
      data: { status: newStatus },
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
    }

    await tx.orderStatusLog.create({
      data: { orderId, statusFrom: currentStatus, statusTo: newStatus, changedBy: userId, catatan },
    });

    return shapeOrder(await findFull(tx, orderId));
  });
}

module.exports = { list, confirmPayment, updateStatus };
