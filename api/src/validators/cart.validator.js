const { z } = require('zod');
const { memberPhoneSchema } = require('./common');

const cartTotalSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
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
  customerPhone: memberPhoneSchema,
  // Not used for pricing — the table's QR token scopes the member-lookup
  // rate limit per table instead of per cafe-wide IP (rateLimit.js's
  // memberLookupLimiter), and is REQUIRED (and verified) whenever
  // customerPhone is present (cart.service.js). Optional otherwise, so the
  // plain cart total keeps working without it.
  token: z.string().trim().max(64).optional(),
});

module.exports = { cartTotalSchema };
