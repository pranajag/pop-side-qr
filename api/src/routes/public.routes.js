const { Router } = require('express');
const path = require('path');
const AppError = require('../utils/AppError');
const { PRODUCTS_DIR } = require('../services/productPhoto.service');

// Filenames are always our own randomUUID() + extension (see
// productPhoto.service) — anything else, including a crafted `../`
// segment, is rejected before it ever reaches path.join/sendFile.
const FILENAME_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

const router = Router();

// Intentionally unauthenticated: product photos are shown on the public,
// no-login menu (Sprint 3) — this is the one upload category AGENTS.md's
// "serve via an auth-gated route" rule doesn't apply to, since there's
// nothing sensitive in a menu photo. Payment proof uploads (Sprint 4) are
// a different, private category and must NOT be exposed this way.
router.get('/products/photo/:filename', (req, res, next) => {
  const { filename } = req.params;
  if (!FILENAME_PATTERN.test(filename)) {
    return next(new AppError(404, 'File tidak ditemukan'));
  }

  const filePath = path.join(PRODUCTS_DIR, filename);
  if (path.dirname(filePath) !== PRODUCTS_DIR) {
    return next(new AppError(404, 'File tidak ditemukan'));
  }

  res.sendFile(filePath, { maxAge: '365d', immutable: true }, (err) => {
    if (!err) return;
    next(err.code === 'ENOENT' ? new AppError(404, 'File tidak ditemukan') : err);
  });
});

module.exports = router;
