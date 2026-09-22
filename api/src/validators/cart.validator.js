const { z } = require('zod');

const cartTotalSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.coerce.number().int().positive(),
        qty: z.coerce.number().int().positive().max(99),
        variantOptionIds: z.array(z.coerce.number().int().positive()).max(20).optional(),
      })
    )
    .min(1)
    .max(50),
  // Optional: lets the checkout screen preview the member discount this
  // number qualifies for before the order is placed. Only ever a lookup
  // key — the discount percentage itself comes from the customer's stored
  // points, never from the request.
  customerPhone: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(20).optional()),
  // Not used for pricing — the table's QR token is only what scopes the
  // member-lookup rate limit per table instead of per cafe-wide IP
  // (rateLimit.js's memberLookupLimiter). Optional so a preview without it
  // still works, just sharing one bucket.
  token: z.string().trim().max(64).optional(),
});

module.exports = { cartTotalSchema };
