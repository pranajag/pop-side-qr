const { z } = require('zod');

const orderItemsSchema = z
  .array(
    z.object({
      productId: z.coerce.number().int().positive(),
      qty: z.coerce.number().int().positive().max(99),
      variantOptionIds: z.array(z.coerce.number().int().positive()).max(20).optional(),
      catatan: z.string().trim().max(200).optional(),
    })
  )
  .min(1)
  .max(50);

const createOrderSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/, 'Token meja tidak valid'),
  metode: z.enum(['qris', 'tunai', 'debit']),
  catatan: z.string().trim().max(200).optional(),
  items: orderItemsSchema,
  // One per checkout attempt, resent unchanged on a client-side retry —
  // lets createOrder recognize a retry and return the original order
  // instead of creating a second one. Optional so nothing breaks if an
  // older frontend build (or a direct API caller) omits it.
  idempotencyKey: z.string().uuid().optional(),
});

const createManualOrderSchema = z
  .object({
    customerName: z.string().trim().max(100).optional(),
    metode: z.enum(['qris', 'tunai', 'debit']),
    catatan: z.string().trim().max(200).optional(),
    items: orderItemsSchema,
    // Staff-entered discount — createOrderSchema (public checkout) has no
    // equivalent field on purpose, a customer must never set their own
    // price. discountReason required whenever an amount is given, so a
    // discount always has an audited reason attached, never a bare number.
    discountAmount: z.coerce.number().int().min(0).max(999999999).optional(),
    discountReason: z.string().trim().max(200).optional(),
  })
  .refine((data) => !data.discountAmount || data.discountReason, {
    message: 'Alasan diskon wajib diisi kalau ada potongan',
    path: ['discountReason'],
  });

module.exports = { createOrderSchema, createManualOrderSchema };
