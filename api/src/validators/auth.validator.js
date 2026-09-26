const { z } = require('zod');
const { usernameSchema, passwordSchema } = require('./common');

const loginSchema = z.strictObject({
  username: usernameSchema,
  password: passwordSchema,
});

// Kode 6 digit dari aplikasi authenticator, atau kode cadangan XXXX-XXXX.
const kode2faSchema = z.strictObject({ kode: z.string().trim().min(6).max(12) });

module.exports = { loginSchema, kode2faSchema };
