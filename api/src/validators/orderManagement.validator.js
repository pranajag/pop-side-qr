const { z } = require('zod');

const updateStatusSchema = z.object({
  status: z.enum(['cooking', 'ready', 'completed', 'cancelled']),
  catatan: z.string().trim().max(200).optional(),
});

module.exports = { updateStatusSchema };
