const { z } = require('zod');

const updateStatusSchema = z.object({
  status: z.enum(['cooking', 'ready', 'completed', 'cancelled']),
  catatan: z.string().trim().max(200).optional(),
  // Only meaningful when status is 'cancelled' on an order that had
  // already collected cash — service.js ignores it otherwise.
  refundAmount: z.coerce.number().min(0).max(999999999).optional(),
  // Only checked when voiding an already-paid order (service.js decides,
  // not this schema) — a plain pre-payment cancel ignores it even if sent.
  pin: z.string().max(10).optional(),
});

module.exports = { updateStatusSchema };
