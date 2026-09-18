const { z } = require('zod');
const { usernameSchema, passwordSchema } = require('./common');

const loginSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

module.exports = { loginSchema };
