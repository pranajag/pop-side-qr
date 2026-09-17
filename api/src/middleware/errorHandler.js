const { ZodError } = require('zod');
const multer = require('multer');
const { invalidCsrfTokenError } = require('./csrf');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  if (err === invalidCsrfTokenError || err?.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }

  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran file maksimal 2MB' : 'Upload gagal';
    return res.status(400).json({ error: message });
  }

  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin tidak diizinkan' });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  logger.error({ err }, 'Unhandled error');

  if (process.env.NODE_ENV === 'production') {
    return res.status(500).json({ error: 'Internal server error' });
  }

  return res.status(500).json({ error: err.message, stack: err.stack });
}

module.exports = errorHandler;
