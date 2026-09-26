const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return next(result.error);
  }
  req.body = result.data;
  next();
};

// Query string divalidasi dengan cara yang sama. Hasilnya di req.validQuery,
// bukan menimpa req.query — di Express 5 req.query hanya-baca.
const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    return next(result.error);
  }
  req.validQuery = result.data;
  next();
};

module.exports = validate;
module.exports.validateQuery = validateQuery;
