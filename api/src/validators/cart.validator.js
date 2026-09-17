const { z } = require('zod');

const cartTotalSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.coerce.number().int().positive(),
        qty: z.coerce.number().int().positive().max(99),
      })
    )
    .min(1)
    .max(50),
});

module.exports = { cartTotalSchema };
