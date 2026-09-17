const { z } = require('zod');
const { zBooleanish } = require('./common');

const createTableSchema = z.object({
  nomorMeja: z.string().trim().min(1).max(20),
  isActive: zBooleanish.default(true),
});

const updateTableSchema = createTableSchema.partial();

module.exports = { createTableSchema, updateTableSchema };
