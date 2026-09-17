const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { detectImageType } = require('../utils/fileSignature');

// Shared by every image upload category (product photos, store settings'
// QRIS image, ...): magic-byte validated, random filename, path
// containment checked before every filesystem write (AGENTS.md upload +
// path-traversal rules). Each category gets its own subdirectory.
function createImageStore(subdir) {
  const dir = path.resolve(__dirname, '../../uploads', subdir);
  fs.mkdirSync(dir, { recursive: true });

  async function save(buffer) {
    const signature = detectImageType(buffer);
    if (!signature) {
      throw new AppError(400, 'Foto harus berformat JPEG, PNG, atau WebP asli');
    }

    const filename = `${crypto.randomUUID()}${signature.ext}`;
    const destPath = path.join(dir, filename);
    if (path.dirname(destPath) !== dir) {
      // Unreachable with a randomUUID()-derived name — kept as a hard
      // guarantee per AGENTS.md's path-traversal rule.
      throw new AppError(400, 'Nama file tidak valid');
    }

    await fs.promises.writeFile(destPath, buffer);
    return filename;
  }

  async function remove(filename) {
    if (!filename) return;
    const filePath = path.join(dir, filename);
    if (path.dirname(filePath) !== dir) return;

    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ err, filename, subdir }, 'Failed to delete uploaded image file');
      }
    }
  }

  // Filenames are always our own randomUUID() + extension (see save()
  // above) — anything else, including a crafted `../` segment, is
  // rejected before it ever reaches path.join/sendFile.
  const FILENAME_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

  function serve(req, res, next) {
    const { filename } = req.params;
    if (!FILENAME_PATTERN.test(filename)) {
      return next(new AppError(404, 'File tidak ditemukan'));
    }

    const filePath = path.join(dir, filename);
    if (path.dirname(filePath) !== dir) {
      return next(new AppError(404, 'File tidak ditemukan'));
    }

    // Helmet's default Cross-Origin-Resource-Policy (same-origin) blocks
    // admin-web/public-web from loading this <img src> at all, since they
    // run on different ports/origins than the API. These files are public
    // by design (menu photos, the store's QRIS image), so this is safe to
    // relax — unlike the JSON API responses, which keep Helmet's default.
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');

    res.sendFile(filePath, { maxAge: '365d', immutable: true }, (err) => {
      if (!err) return;
      next(err.code === 'ENOENT' ? new AppError(404, 'File tidak ditemukan') : err);
    });
  }

  return { dir, save, remove, serve };
}

module.exports = { createImageStore };
