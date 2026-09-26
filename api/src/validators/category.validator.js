const { z } = require('zod');
const { zBooleanish } = require('./common');

const createCategorySchema = z.strictObject({
  nama: z.string().trim().min(1).max(100),
  urutan: z.coerce.number().int().min(0).default(0),
  isActive: zBooleanish.default(true),
  // Empty string from a cleared number input means "no estimate" — mapped
  // to null (not undefined/omitted), so clearing a previously-set value on
  // update actually writes NULL instead of Prisma silently leaving the old
  // value untouched (that's what undefined means to a Prisma `update`).
  estimasiMenit: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.coerce.number().int().min(1).max(999).nullable()
  ),
});

const updateCategorySchema = createCategorySchema.partial();

module.exports = { createCategorySchema, updateCategorySchema };
