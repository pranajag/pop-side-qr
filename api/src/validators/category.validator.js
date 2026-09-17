const { z } = require('zod');
const { zBooleanish } = require('./common');

const createCategorySchema = z.object({
  nama: z.string().trim().min(1).max(100),
  urutan: z.coerce.number().int().min(0).default(0),
  isActive: zBooleanish.default(true),
});

const updateCategorySchema = createCategorySchema.partial();

module.exports = { createCategorySchema, updateCategorySchema };
