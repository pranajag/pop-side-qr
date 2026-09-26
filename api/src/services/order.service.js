const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { generateOrderCode } = require('../utils/orderCode');
const { isUniqueConstraintError } = require('../utils/prismaErrors');
const { resolveProductVariants } = require('../utils/productVariants');
const { jakartaDayBoundsUTC } = require('../utils/jakartaTime');
const { NON_TERMINAL_STATUSES } = require('../utils/orderStatus');
const tableService = require('./table.service');
const paymentProof = require('./paymentProof.service');
const customerService = require('./customer.service');
const settingsService = require('./settings.service');
const webhookService = require('./webhook.service');
const shiftService = require('./shift.service');
const { samaAman } = require('../utils/kripto');
const realtime = require('../realtime');

// Order publik hanya bisa dilihat/diurus dari perangkat yang membuatnya:
// deviceHash = sidik cookie httpOnly perangkat itu (utils/cookiePublik.js).
// Order tanpa deviceHash (buatan staff, atau dari sebelum aturan ini ada)
// tidak bisa dilacak dari web publik sama sekali. Tidak cocok dijawab
// "tidak ditemukan" — sama persis dengan kode yang memang tidak ada, jadi
// tidak ada yang bisa dipelajari dengan menebak kode.
function milikPerangkat(order, deviceHash) {
  return Boolean(order?.deviceHash && deviceHash && samaAman(order.deviceHash, deviceHash));
}

const MAX_CODE_ATTEMPTS = 5;
// Akhiran meja (-M1 / -MA2 / -TA) opsional: kode yang dibuat sebelum
// akhiran itu ada harus tetap bisa dilacak dan dibayar, bukan ditolak di
// gerbang ini. Bentuk lengkapnya dijelaskan di utils/orderCode.js.
const KODE_ORDER_PATTERN = /^ORD-\d{8}-[A-Z0-9]{4}(?:-(?:M[A-Z0-9]{1,4}|TA))?$/;

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
    // isBillOpen resets here too — a genuinely new visit (table was fully
    // clear beforehand) must never inherit an earlier, unrelated group's
    // "belum minta bayar" flag that staff simply forgot to close out.
    await tx.table.update({
      where: { id: tableId },
      data: { currentVisitStartedAt: new Date(), isBillOpen: false },
    });
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

// Tax/service charge folds straight into totalHarga so every already-built
// system keyed off it (revenue reports, shift cash reconciliation, loyalty
// points, webhooks) keeps working with zero changes of its own;
// taxAmount/serviceChargeAmount are kept only so a receipt can show the
// breakdown. The arithmetic itself now lives in settings.service.js, shared
// with the checkout preview so both quote the same total.
const { computeTaxAndService } = settingsService;

async function createOrder({ token, metode, catatan, items, idempotencyKey, customerPhone }, { deviceHash = null, memberTerverifikasi = false } = {}) {
  const table = await tableService.verifyToken(token);
  if (!table) {
    throw new AppError(404, 'Meja tidak valid. Coba scan ulang QR.');
  }

  // Nobody clocked in means nobody can confirm the payment, cook the food,
  // or hand it over — the order would just sit pending until someone finds
  // it hours later, with the customer sitting at a table expecting it. The
  // same gate the staff side already has (assertActiveShift in
  // orderManagement.service.js), applied to the entrance instead of only
  // the counter. public-web shows a closed state from GET /public/settings
  // so it rarely gets this far; this is the boundary that actually holds.
  if (!(await shiftService.isAnyShiftActive())) {
    // Tagged so the checkout screen can lock itself instead of leaving the
    // customer tapping a button that will keep failing — the cafe can close
    // while they are still filling the form, and public-web only learns the
    // status when the page loads.
    throw new AppError(
      409,
      'Kafe sedang tutup — belum ada staff yang mulai shift. Pesanan belum bisa dibuat.',
      'CAFE_CLOSED'
    );
  }

  // A retry (dropped connection, timeout, double-tap) resends the same
  // idempotencyKey — if the first attempt actually made it through, return
  // that order as-is instead of taking payment/stock twice for one tap.
  if (idempotencyKey) {
    const existing = await prisma.order.findUnique({ where: { idempotencyKey }, include: { items: true } });
    // Kunci yang sama dari perangkat LAIN bukan percobaan ulang — jangan
    // pernah mengembalikan order orang lain hanya karena kuncinya ditebak.
    if (existing && !milikPerangkat(existing, deviceHash)) {
      throw new AppError(409, 'Permintaan ini sudah pernah dipakai. Muat ulang halaman lalu coba lagi.');
    }
    if (existing) return existing;
  }

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const kodeOrder = generateOrderCode(table.nomorMeja);
    try {
      // Interactive transaction: every read+conditional-write below runs
      // in one DB transaction, so a thrown error (bad item, stock race
      // lost) rolls back everything — including stock already decremented
      // for earlier items in this same attempt.
      const created = await prisma.$transaction(async (tx) => {
        await bumpVisitIfTableIsFree(tx, table.id);
        const { orderItemsData, totalHarga: subtotal } = await buildOrderItems(tx, items);

        // Member discount: the tier the customer's *already banked* points
        // qualify them for, resolved from the database off the phone number
        // alone. The request never carries a price or a percentage, so this
        // stays inside AGENTS.md's rule that a customer can't set their own
        // price — the same rule the staff-entered discount on manual orders
        // follows from the other direction.
        //
        // Deliberately the same shape cart.service.js quotes on the
        // checkout screen, in the same order (discount first, then tax and
        // service on the remainder), so what was previewed is what gets
        // charged.
        //
        // Diskon tier hanya kalau nomor itu sudah diverifikasi OTP oleh
        // pemesan ini (memberOtp.service.js) — tahu nomor HP member orang
        // lain tidak cukup untuk memakai diskonnya. Tanpa verifikasi, order
        // tetap jalan tanpa diskon, dan poinnya tetap masuk ke pemilik nomor.
        const { tier, discountAmount } = memberTerverifikasi
          ? await customerService.resolveMemberDiscount(tx, customerPhone, subtotal)
          : { tier: null, discountAmount: 0 };
        const afterDiscount = subtotal - discountAmount;
        const { taxAmount, serviceChargeAmount, totalHarga } = await computeTaxAndService(tx, afterDiscount);

        // Member auto-join: the customer's own opt-in on public checkout,
        // not staff entering it on their behalf (createManualOrder's own
        // customerPhone). pointsEarned is snapshotted now but NOT credited
        // yet — unlike a manual order (already 'confirmed', payment already
        // in hand at creation), this one starts 'pending'/'waiting_verif'
        // and might never actually get paid.
        // orderManagement.service.js's confirmPayment credits it at the
        // moment a kasir actually confirms payment, the same snapshot
        // updateStatus's void path already claws back with reversePoints.
        //
        // Qualifying for a tier does not spend points: the discount is a
        // standing benefit of the balance, so the balance is untouched here
        // and keeps earning below, exactly as Pesanan Manual already
        // behaves for the same customer.
        // Gated on the same master switch as the discount above: with
        // loyalty off, a phone number that slips through (an older app
        // build, a direct API call) must not quietly enrol anyone or bank
        // points against a programme the store has turned off.
        let customer = null;
        let pointsEarned = 0;
        if (customerPhone && (await settingsService.isMemberEnabled(tx))) {
          customer = await customerService.findOrCreateByPhone(tx, customerPhone, null);
          pointsEarned = customerService.pointsFor(totalHarga);
        }

        return tx.order.create({
          data: {
            kodeOrder,
            tableId: table.id,
            customerId: customer?.id ?? null,
            pointsEarned,
            status: 'pending',
            metode,
            totalHarga,
            discountAmount,
            // Reads as "Diskon (Member 1% (≥ 5 poin))" wherever a receipt or
            // the tracking page wraps it in its own "Diskon" label, and
            // matches the phrasing Pesanan Manual already writes for the
            // staff-applied version of the same discount.
            discountReason: tier ? `Member ${tier.discountPercent}% (≥ ${tier.minPoints} poin)` : null,
            taxAmount,
            serviceChargeAmount,
            catatan,
            idempotencyKey: idempotencyKey ?? undefined,
            deviceHash,
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
      realtime.keStaff('order:baru', { id: created.id, kodeOrder: created.kodeOrder });
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
  cashReceived,
}) {
  // Same shift-accountability gate as orderManagement.service.js's
  // confirmPayment/updateStatus — a manual counter sale is cash-handling
  // too (money changes hands the instant this is created, unlike a public
  // dine-in order which starts unpaid), so it's just as much off-the-books
  // as confirming a QRIS payment with no shift open would be.
  const activeShift = await shiftService.getActiveShift(userId);
  if (!activeShift) {
    throw new AppError(403, 'Mulai shift dulu sebelum bisa proses pesanan.');
  }

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    // null, bukan nomor meja: pesanan manual adalah penjualan di kasir yang
    // memang tidak menempel ke meja mana pun (tableId-nya juga null), jadi
    // kodenya berakhiran -TA.
    const kodeOrder = generateOrderCode(null);
    try {
      const created = await prisma.$transaction(async (tx) => {
        const { orderItemsData, totalHarga: subtotal } = await buildOrderItems(tx, items);
        // Two sources, and only one ever wins. A staff-entered discount is
        // an explicit override with its own audited reason, so it takes
        // precedence and is never stacked on top of anything. With no such
        // override, a member's own tier discount applies by itself — a
        // regular paying cash at the counter gets exactly the benefit they
        // would get scanning the QR, without staff having to remember a
        // button. Capped at the subtotal either way so totalHarga can never
        // go negative.
        let discount = Math.min(discountAmount ?? 0, subtotal);
        let resolvedDiscountReason = discount > 0 ? discountReason : null;
        if (discount === 0 && customerPhone) {
          const member = await customerService.resolveMemberDiscount(tx, customerPhone, subtotal);
          if (member.tier && member.discountAmount > 0) {
            discount = member.discountAmount;
            resolvedDiscountReason = `Member ${member.tier.discountPercent}% (≥ ${member.tier.minPoints} poin)`;
          }
        }
        const afterDiscount = subtotal - discount;
        const { taxAmount, serviceChargeAmount, totalHarga } = await computeTaxAndService(tx, afterDiscount);

        // Cash handed over at the counter, so the screen can tell the kasir
        // the change to give back. Validated here rather than in the
        // validator because only this point knows what the order finally
        // costs, once discount, tax and service have all been applied.
        if (cashReceived !== undefined && cashReceived !== null) {
          if (metode !== 'tunai') {
            throw new AppError(400, 'Uang diterima hanya berlaku untuk pembayaran tunai.');
          }
          if (cashReceived < totalHarga) {
            throw new AppError(
              400,
              `Uang diterima (${cashReceived}) kurang dari total pesanan (${totalHarga}).`
            );
          }
        }

        // Loyalty: optional, staff-entered here. Earns points on what was
        // actually paid, post-discount and post-tax/service. Skipped
        // entirely while the store has the member feature switched off, so
        // staff can't half-enrol someone into a dormant programme.
        let customer = null;
        let pointsEarned = 0;
        if (customerPhone && (await settingsService.isMemberEnabled(tx))) {
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
            taxAmount,
            serviceChargeAmount,
            discountAmount: discount,
            discountReason: resolvedDiscountReason,
            catatan,
            items: { create: orderItemsData },
            payment: { create: { metode, amount: totalHarga, cashReceived } },
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
      realtime.keStaff('order:berubah', { id: created.id });
      // The change owed is what the kasir needs on screen the moment this
      // returns, and this endpoint hands back the raw order row rather than
      // orderManagement.service.js's shaped one — so the two cash fields
      // are appended here. Derived, never stored twice: same rule as the
      // confirm-payment path.
      const cash = cashReceived ?? null;
      return {
        ...created,
        cashReceived: cash,
        changeAmount: cash === null ? null : cash - Number(created.totalHarga),
      };
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        continue;
      }
      throw err;
    }
  }

  throw new AppError(500, 'Gagal membuat kode order, coba lagi.');
}

async function confirmQrisPayment(kodeOrder, fileBuffer, deviceHash) {
  if (!KODE_ORDER_PATTERN.test(kodeOrder)) {
    throw new AppError(404, 'Order tidak ditemukan');
  }

  const order = await prisma.order.findUnique({ where: { kodeOrder } });
  if (!order || !milikPerangkat(order, deviceHash)) {
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
    const hasil = await prisma.$transaction(async (tx) => {
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
    realtime.keStaff('order:berubah', { id: order.id, status: 'waiting_verif' });
    realtime.keOrder(order.id, 'order:status', { kodeOrder: order.kodeOrder, status: 'waiting_verif' });
    return hasil;
  } catch (err) {
    await paymentProof.remove(buktiFile);
    throw err;
  }
}

// Id order untuk token realtime (realtime.js) — aturannya sama persis
// dengan pelacakan: hanya perangkat pemesan, selain itu "tidak ditemukan".
async function idMilikPerangkat(kodeOrder, deviceHash) {
  if (!KODE_ORDER_PATTERN.test(kodeOrder)) throw new AppError(404, 'Order tidak ditemukan');
  const order = await prisma.order.findUnique({ where: { kodeOrder }, select: { id: true, deviceHash: true } });
  if (!order || !milikPerangkat(order, deviceHash)) throw new AppError(404, 'Order tidak ditemukan');
  return order.id;
}

async function getByCode(kodeOrder, deviceHash) {
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
  if (!order || !milikPerangkat(order, deviceHash)) {
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
    taxAmount: Number(order.taxAmount),
    serviceChargeAmount: Number(order.serviceChargeAmount),
    catatan: order.catatan,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    nomorMeja: order.table?.nomorMeja ?? null,
    customerName: order.customerName,
    pointsEarned: order.pointsEarned ?? 0,
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

module.exports = { createOrder, createManualOrder, confirmQrisPayment, getByCode, idMilikPerangkat, getTableBill };
