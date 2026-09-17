const { z } = require('zod');

const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_.-]+$/),
  // 72 = bcrypt's silent input-truncation boundary, so validation never
  // accepts a password whose tail bcrypt would just discard.
  password: z.string().min(8).max(72),
});

module.exports = { loginSchema };
