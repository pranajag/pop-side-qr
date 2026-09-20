const { z } = require('zod');

// Empty string from a cleared form field means "remove this" (store the
// null so the receipt stops printing that line), not "reject the request" —
// preprocessed to null before z.string() ever sees it, same pattern
// customer.service.js's customerPhone field already uses.
const emptyToNull = (schema) =>
  z.preprocess((v) => (v === '' ? null : v), schema.nullable().optional());

const updateStoreInfoSchema = z.object({
  namaToko: emptyToNull(z.string().trim().max(100)),
  alamat: emptyToNull(z.string().trim().max(300)),
  telepon: emptyToNull(z.string().trim().max(30)),
  // 0-100, up to 2 decimals — a rate of e.g. 11.5% is a realistic Indonesian
  // service-charge figure, no realistic tax/service rate exceeds 100%.
  pajakPersen: z.coerce.number().min(0).max(100).optional(),
  serviceChargePersen: z.coerce.number().min(0).max(100).optional(),
});

module.exports = { updateStoreInfoSchema };
