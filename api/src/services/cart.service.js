const prisma = require('../lib/prisma');
const { resolveProductVariants } = require('../utils/productVariants');

// Client sends only { productId, qty, variantOptionIds }; price always
// comes from the DB, never trusted from the request (AGENTS.md core rule).
// Invalid lines are reported in `issues` rather than failing the whole
// request, so the frontend can show exactly what changed instead of a
// generic error.
async function computeTotal(items) {
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { variantGroups: { include: { options: true } } },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  const lineItems = [];
  const issues = [];
  let total = 0;

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
    const subtotal = harga * qty;
    total += subtotal;
    lineItems.push({ productId: product.id, nama: product.nama, harga, qty, subtotal });
  }

  return { items: lineItems, total, issues };
}

module.exports = { computeTotal };
