const { z } = require('zod');
const { usernameSchema, passwordSchema, pinSchema } = require('./common');

const createUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(['admin', 'kasir']),
  isActive: z.boolean().default(true),
  pin: pinSchema.optional(),
});

// password/pin are optional on update — omitting either leaves its existing
// hash untouched, since most edits here are just a role or isActive change.
const updateUserSchema = z.object({
  username: usernameSchema.optional(),
  password: passwordSchema.optional(),
  role: z.enum(['admin', 'kasir']).optional(),
  isActive: z.boolean().optional(),
  pin: pinSchema.optional(),
});

module.exports = { createUserSchema, updateUserSchema };
