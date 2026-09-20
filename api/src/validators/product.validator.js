const { z } = require('zod');
const { zBooleanish } = require('./common');

const variantOptionSchema = z.object({
  nama: z.string().trim().min(1).max(100),
  // Can go negative — e.g. a "Small" option priced below the product's
  // base (Medium) price — not just upcharges like "Large +5000".
  hargaTambahan: z.coerce.number().int().min(-1_000_000).max(1_000_000).default(0),
});

const variantGroupSchema = z.object({
  nama: z.string().trim().min(1).max(100),
  required: z.boolean().default(false),
  multiple: z.boolean().default(false),
  options: z.array(variantOptionSchema).min(1).max(30),
});

// Multipart forms (needed for the photo file) can't carry a nested array
// natively, so the client sends it as one JSON-stringified field — parsed
// here before the real array/object shape is validated below.
const variantGroupsField = z.preprocess((val) => {
  if (typeof val !== 'string' || val === '') return val;
  try {
    return JSON.parse(val);
  } catch {
    return val; // let z.array reject it below with a normal validation error
  }
}, z.array(variantGroupSchema).max(10).default([]));

// harga is a whole Rupiah amount — sub-Rupiah pricing isn't a real thing
// for this business, and validating as an integer sidesteps float
// precision issues a decimal multipleOf check would otherwise hit.
const productBase = {
  categoryId: z.coerce.number().int().positive(),
  nama: z.string().trim().min(1).max(150),
  harga: z.coerce.number().int().nonnegative(),
  // Optional cost price (HPP), report.service.js's margin calc — blank form
  // field arrives as '', mapped to undefined (leaves it unset) rather than
  // failing z.coerce.number() on NaN.
  hargaModal: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().nonnegative().optional()
  ),
  stok: z.coerce.number().int().nonnegative().default(0),
  trackStock: zBooleanish.default(false),
  isAvailable: zBooleanish.default(true),
  variantGroups: variantGroupsField,
};

const createProductSchema = z.object(productBase);
const updateProductSchema = z.object(productBase).partial();

module.exports = { createProductSchema, updateProductSchema };
