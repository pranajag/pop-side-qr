const prisma = require('../lib/prisma');
const { resolveProductVariants } = require('../utils/productVariants');
const customerService = require('./customer.service');
const settingsService = require('./settings.service');

// Client sends only { productId, qty, variantOptionIds }; price always
// comes from the DB, never trusted from the request (AGENTS.md core rule).
// Invalid lines are reported in `issues` rather than failing the whole
// request, so the frontend can show exactly what changed instead of a
// generic error.
async function computeTotal(items, customerPhone) {
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { variantGroups: { include: { options: true } } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  const lineItems = [];
  const issues = [];
  let subtotal = 0;

  for (const { productId, qty, variantOptionIds } of items) {
    const product = productById.get(productId);
    if (!product) {
      issues.push({ productId, message: 'Produk tidak ditemukan' });
      continue;
    }
    if (!product.isAvailable) {
      issues.push({ productId, message: `${product.nama} sudah tidak tersedia` });
      continue;
    }
    if (product.trackStock && product.stok < qty) {
      issues.push({ productId, message: `Stok ${product.nama} tinggal ${product.stok}` });
      continue;
    }

    const resolved = resolveProductVariants(product, variantOptionIds);
    if (resolved.error) {
      issues.push({ productId, message: resolved.error });
      continue;
    }

    const harga = Number(product.harga) + resolved.extraPerUnit;
    const lineSubtotal = harga * qty;
    subtotal += lineSubtotal;
    // variants included so two lines of the same product with different
    // selections (e.g. "Es Teh" Large vs Regular) don't render as two
    // identical-looking rows in the checkout summary — CheckoutView.vue
    // needs this to tell them apart before the customer pays.
    lineItems.push({
      productId: product.id,
      nama: product.nama,
      harga,
      qty,
      subtotal: lineSubtotal,
      variants: resolved.snapshots,
    });
  }

  // Same three steps createOrder takes, in the same order, so the number
  // quoted here is the number that will actually be charged: member
  // discount off the subtotal, then tax/service on what remains.
  const { customer, tier, discountAmount } = await customerService.resolveMemberDiscount(
    prisma,
    customerPhone,
    subtotal
  );
  const afterDiscount = subtotal - discountAmount;
  const { taxAmount, serviceChargeAmount, totalHarga } = await settingsService.computeTaxAndService(
    prisma,
    afterDiscount
  );

  return {
    items: lineItems,
    subtotal,
    discountAmount,
    taxAmount,
    serviceChargeAmount,
    // What this order will add to the member's balance once it's paid.
    // Computed here rather than in the browser so the "you'll earn N
    // points" line on the checkout screen can't drift from the rule
    // confirmPayment actually credits by.
    pointsToEarn: customerPhone ? customerService.pointsFor(totalHarga) : 0,
    // Kept named `total` — it has always meant "what the customer pays",
    // and every existing caller reads it that way.
    total: totalHarga,
    // Null whenever the phone is blank, unknown, or below every tier, so
    // the frontend has one shape to branch on. points is what the number
    // has banked so far, not what this order will add.
    member:
      customer === null
        ? null
        : { telepon: customer.telepon, points: customer.points, tier, discountAmount },
    issues,
  };
}

module.exports = { computeTotal };
