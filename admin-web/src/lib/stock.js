// One fixed threshold for every tracked product — simplest version of "low
// stock" that's still useful; a per-product threshold would need its own
// schema field and admin UI for a need nobody's asked for yet.
export const LOW_STOCK_THRESHOLD = 5

// null = nothing to flag (not tracked, or plenty left).
export function stockStatus(product) {
  if (!product.trackStock) return null
  if (product.stok <= 0) return 'habis'
  if (product.stok <= LOW_STOCK_THRESHOLD) return 'menipis'
  return null
}
