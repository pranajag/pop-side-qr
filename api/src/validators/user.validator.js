const { z } = require('zod');
const { usernameSchema, passwordSchema } = require('./common');

const createUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(['admin', 'kasir']),
  isActive: z.boolean().default(true),
});

// password is optional on update — omitting it leaves the existing hash
// untouched, since most edits here are just a role or isActive change.
const updateUserSchema = z.object({
  username: usernameSchema.optional(),
  password: passwordSchema.optional(),
  role: z.enum(['admin', 'kasir']).optional(),
  isActive: z.boolean().optional(),
});

module.exports = { createUserSchema, updateUserSchema };
