const { z } = require('zod');

const createOrderSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/, 'Token meja tidak valid'),
  metode: z.enum(['qris', 'tunai', 'debit']),
  catatan: z.string().trim().max(200).optional(),
  items: z
    .array(
      z.object({
        productId: z.coerce.number().int().positive(),
        qty: z.coerce.number().int().positive().max(99),
        variantOptionIds: z.array(z.coerce.number().int().positive()).max(20).optional(),
        catatan: z.string().trim().max(200).optional(),
      })
    )
    .min(1)
    .max(50),
});

module.exports = { createOrderSchema };
