const { z } = require('zod');
const { zBooleanish } = require('./common');

const createTableSchema = z.object({
  nomorMeja: z.string().trim().min(1).max(20),
  isActive: zBooleanish.default(true),
  kapasitas: z.coerce.number().int().min(1).max(999).default(4),
});

const updateTableSchema = createTableSchema.partial();

module.exports = { createTableSchema, updateTableSchema };
