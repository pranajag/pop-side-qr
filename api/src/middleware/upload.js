const multer = require('multer');
const AppError = require('../utils/AppError');

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB, per AGENTS.md upload rule

// memoryStorage: nothing touches disk here. This is only a cheap
// pre-filter on the client-supplied Content-Type — the authoritative check
// is the magic-byte sniff in productPhoto.service, run on the buffer this
// hands off.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new AppError(400, 'Foto harus berformat JPEG, PNG, atau WebP'));
    }
    cb(null, true);
  },
});

module.exports = { upload, MAX_FILE_SIZE };
