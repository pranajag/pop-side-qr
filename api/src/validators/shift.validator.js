const { z } = require('zod');

const endShiftSchema = z.object({
  cashCounted: z.coerce.number().min(0).max(999999999),
  // Sales from marketplace channels (GrabFood/GoFood/etc) that never create
  // an Order row here — required alongside cashCounted so shift reports
  // don't silently omit revenue that's real but outside this system.
  onlineSalesAmount: z.coerce.number().min(0).max(999999999),
});

module.exports = { endShiftSchema };
