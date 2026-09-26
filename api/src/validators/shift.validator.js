const { z } = require('zod');

const startShiftSchema = z.strictObject({
  cashStart: z.coerce.number().min(0).max(999999999),
  // The actual person on shift, not the login account — see
  // schema.prisma's Shift.namaStaff comment for why these can differ.
  namaStaff: z.string().trim().min(1).max(100),
});

const endShiftSchema = z.strictObject({
  cashCounted: z.coerce.number().min(0).max(999999999),
  // Optional (store owner's explicit request) — a shift with no Gojek/
  // GrabFood orders at all shouldn't force the kasir to type a 0 they
  // don't actually know is accurate. Omitted entirely (not coerced to 0)
  // when the kasir leaves it blank, so shapeShift's own null-vs-0
  // distinction (shift.service.js) stays meaningful: null means "never
  // recorded", 0 means "recorded as zero".
  gojekAmount: z.coerce.number().min(0).max(999999999).optional(),
  grabfoodAmount: z.coerce.number().min(0).max(999999999).optional(),
});

module.exports = { startShiftSchema, endShiftSchema };
