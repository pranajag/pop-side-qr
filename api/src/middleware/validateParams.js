const { z } = require('zod');

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

function validateIdParam(req, res, next) {
  const result = idParamSchema.safeParse(req.params);
  if (!result.success) {
    return next(result.error);
  }
  req.params = result.data;
  next();
}

module.exports = { validateIdParam };
