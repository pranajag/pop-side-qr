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

// Numeric only, 4-6 digits — short enough to type quickly under pressure
// (voiding a paid order mid-rush), never meant to carry password-grade
// entropy on its own; pinAttempts.js's lockout is what actually protects it.
const pinSchema = z.string().regex(/^\d{4,6}$/, 'PIN harus 4-6 digit angka');

module.exports = { zBooleanish, usernameSchema, passwordSchema, pinSchema };
