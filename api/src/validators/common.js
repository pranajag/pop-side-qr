const { z } = require('zod');

// Multipart/form-data always sends field values as strings, and zod's
// z.coerce.boolean() uses JS `Boolean(str)` — which makes the STRING
// "false" coerce to `true`. This accepts a real boolean (JSON body) or the
// literal string "true"/"false" (form body) only, and rejects anything else.
const zBooleanish = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((val) => (typeof val === 'boolean' ? val : val === 'true'));

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(50)
  .regex(/^[a-zA-Z0-9_.-]+$/);

// 72 = bcrypt's silent input-truncation boundary, so validation never
// accepts a password whose tail bcrypt would just discard.
const passwordSchema = z.string().min(8).max(72);

module.exports = { zBooleanish, usernameSchema, passwordSchema };
