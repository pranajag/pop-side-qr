const { z } = require('zod');
const { zBooleanish } = require('./common');

// harga is a whole Rupiah amount — sub-Rupiah pricing isn't a real thing
// for this business, and validating as an integer sidesteps float
// precision issues a decimal multipleOf check would otherwise hit.
const productBase = {
  categoryId: z.coerce.number().int().positive(),
  nama: z.string().trim().min(1).max(150),
  harga: z.coerce.number().int().nonnegative(),
  stok: z.coerce.number().int().nonnegative().default(0),
  trackStock: zBooleanish.default(false),
  isAvailable: zBooleanish.default(true),
};

const createProductSchema = z.object(productBase);
const updateProductSchema = z.object(productBase).partial();

module.exports = { createProductSchema, updateProductSchema };
