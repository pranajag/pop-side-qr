const { z } = require('zod');

const createApiKeySchema = z.strictObject({
  nama: z.string().trim().min(1).max(100),
});

module.exports = { createApiKeySchema };
