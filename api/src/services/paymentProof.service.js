const { createImageStore } = require('../lib/imageStore');

const store = createImageStore('payment-proof');

// Unlike product/settings images (public, served by filename straight from
// the URL), payment proof is private — a customer's bank/e-wallet receipt.
// This is only ever reached via orderManagement.service.js's
// serveBuktiBayar, which looks the filename up from an authenticated,
// role-gated order first — never exposed by filename on a public route.
// 'privat': tidak boleh disimpan browser atau CDN (lib/imageStore.js).
function serveFile(filename, res, next) {
  store.kirim(filename, res, next, { cache: 'privat' }).catch(next);
}

module.exports = { save: store.save, remove: store.remove, serveFile };
