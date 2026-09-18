const { z } = require('zod');

const createStaffCallSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/, 'Token meja tidak valid'),
  catatan: z.string().trim().max(200).optional(),
});

module.exports = { createStaffCallSchema };
