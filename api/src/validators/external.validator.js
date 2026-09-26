const { z } = require('zod');

// GET /api/external/v1/orders — query yang dikenal hanya dua ini.
const externalOrdersQuerySchema = z.strictObject({
  since: z
    .string()
    .max(40)
    .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Parameter since harus tanggal ISO 8601 yang valid')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

module.exports = { externalOrdersQuerySchema };
