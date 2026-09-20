const { z } = require('zod');

const createApiKeySchema = z.object({
  nama: z.string().trim().min(1).max(100),
});

module.exports = { createApiKeySchema };
