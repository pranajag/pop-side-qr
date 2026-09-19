const { z } = require('zod');

const startShiftSchema = z.object({
  cashStart: z.coerce.number().min(0).max(999999999),
});

const endShiftSchema = z.object({
  cashCounted: z.coerce.number().min(0).max(999999999),
  // Sales from Gojek/GrabFood that never create an Order row here — required
  // alongside cashCounted so shift reports don't silently omit revenue
  // that's real but outside this system. Isi 0 kalau tidak ada.
  gojekAmount: z.coerce.number().min(0).max(999999999),
  grabfoodAmount: z.coerce.number().min(0).max(999999999),
});

module.exports = { startShiftSchema, endShiftSchema };
