const path = require('path');
const { createImageStore } = require('../lib/imageStore');
const AppError = require('../utils/AppError');

const store = createImageStore('payment-proof');

const FILENAME_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

// Unlike product/settings images (public, served by filename straight from
// the URL), payment proof is private — a customer's bank/e-wallet receipt.
// This is only ever reached via orderManagement.service.js's
// serveBuktiBayar, which looks the filename up from an authenticated,
// role-gated order first — never exposed by filename on a public route.
function serveFile(filename, res, next) {
  if (!FILENAME_PATTERN.test(filename)) {
    return next(new AppError(404, 'File tidak ditemukan'));
  }
  const filePath = path.join(store.dir, filename);
  if (path.dirname(filePath) !== store.dir) {
    return next(new AppError(404, 'File tidak ditemukan'));
  }

  // Same cross-origin note as imageStore.js's own serve() — admin-web
  // loads this via <img src> from a different port than the API.
  // maxAge 0 (not the public images' 365d/immutable): this is
  // payment-evidence, not asked to be cached long-lived anywhere.
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.sendFile(filePath, { maxAge: '0' }, (err) => {
    if (!err) return;
    next(err.code === 'ENOENT' ? new AppError(404, 'File tidak ditemukan') : err);
  });
}

module.exports = { save: store.save, remove: store.remove, serveFile };
