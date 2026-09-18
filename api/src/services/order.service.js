const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { generateOrderCode } = require('../utils/orderCode');
const { isUniqueConstraintError } = require('../utils/prismaErrors');
const { resolveProductVariants } = require('../utils/productVariants');
const tableService = require('./table.service');

const MAX_CODE_ATTEMPTS = 5;
const KODE_ORDER_PATTERN = /^ORD-\d{8}-[A-Z0-9]{4}$/;

async function createOrder({ token, metode, catatan, items }) {
  const table = await tableService.verifyToken(token);
  if (!table) {
    throw new AppError(404, 'Meja tidak valid. Coba scan ulang QR.');
  }

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const kodeOrder = generateOrderCode();
    try {
      // Interactive transaction: every read+conditional-write below runs
      // in one DB transaction, so a thrown error (bad item, stock race
      // lost) rolls back everything — including stock already decremented
      // for earlier items in this same attempt.
      return await prisma.$transaction(async (tx) => {
        // One batched read for the initial availability/price snapshot
        // (matches cart.service.js's computeTotal) — safe to batch because
        // it's read-only and happens entirely before any decrement; the
        // atomic updateMany below still independently re-checks stock at
        // decrement time regardless of what this batch saw.
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
            // Atomic check-and-decrement: the WHERE clause and the write
            // happen as one statement, so two concurrent orders for the
            // last unit can't both read stok=1 and both succeed — the
            // second one's UPDATE simply matches zero rows.
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
            // Snapshot, not re-derived later: whether stock was actually
            // taken for this line, independent of whatever trackStock is
            // set to by the time this order might get cancelled.
            stockDecremented: product.trackStock,
            catatan: item.catatan,
            variants: resolved.snapshots.length ? { create: resolved.snapshots } : undefined,
          });
        }

        return tx.order.create({
          data: {
            kodeOrder,
            tableId: table.id,
            status: 'pending',
            metode,
            totalHarga,
            catatan,
            items: { create: orderItemsData },
            payment: { create: { metode, amount: totalHarga } },
          },
          include: { items: true },
        });
      });
    } catch (err) {
      // Order has exactly one unique column (kode_order), so any unique
      // violation here is a same-day code collision — retry with a fresh
      // code rather than failing the customer's checkout over it.
      if (isUniqueConstraintError(err)) {
        continue;
      }
      throw err;
    }
  }

  throw new AppError(500, 'Gagal membuat kode order, coba lagi.');
}

async function confirmQrisPayment(kodeOrder) {
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

  return prisma.$transaction(async (tx) => {
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

    // changedBy is null — this transition is customer-triggered, not staff.
    await tx.orderStatusLog.create({
      data: { orderId: order.id, statusFrom: 'pending', statusTo: 'waiting_verif', changedBy: null },
    });

    return tx.order.findUnique({ where: { kodeOrder } });
  });
}

async function getByCode(kodeOrder) {
  if (!KODE_ORDER_PATTERN.test(kodeOrder)) {
    throw new AppError(404, 'Order tidak ditemukan');
  }

  const order = await prisma.order.findUnique({
    where: { kodeOrder },
    include: {
      items: { include: { product: { select: { nama: true } }, variants: true } },
      table: { select: { nomorMeja: true } },
    },
  });
  if (!order) {
    throw new AppError(404, 'Order tidak ditemukan');
  }

  return {
    kodeOrder: order.kodeOrder,
    status: order.status,
    metode: order.metode,
    totalHarga: Number(order.totalHarga),
    catatan: order.catatan,
    createdAt: order.createdAt,
    nomorMeja: order.table.nomorMeja,
    items: order.items.map((item) => ({
      nama: item.product.nama,
      qty: item.qty,
      harga: Number(item.hargaSaatOrder),
      catatan: item.catatan,
      variants: item.variants.map((v) => ({ namaGroup: v.namaGroup, namaOption: v.namaOption })),
    })),
  };
}

module.exports = { createOrder, confirmQrisPayment, getByCode };
