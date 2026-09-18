const { z } = require('zod');

const endShiftSchema = z.object({
  cashCounted: z.coerce.number().min(0).max(999999999),
});

module.exports = { endShiftSchema };
