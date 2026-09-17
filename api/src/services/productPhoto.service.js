const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { detectImageType } = require('../utils/fileSignature');

const PRODUCTS_DIR = path.resolve(__dirname, '../../uploads/products');
fs.mkdirSync(PRODUCTS_DIR, { recursive: true });

async function save(buffer) {
  const signature = detectImageType(buffer);
  if (!signature) {
    throw new AppError(400, 'Foto harus berformat JPEG, PNG, atau WebP asli');
  }

  const filename = `${crypto.randomUUID()}${signature.ext}`;
  const destPath = path.join(PRODUCTS_DIR, filename);
  if (path.dirname(destPath) !== PRODUCTS_DIR) {
    // Unreachable with a randomUUID()-derived name — kept as a hard
    // guarantee per AGENTS.md's path-traversal rule (resolve + validate
    // containment before every filesystem write).
    throw new AppError(400, 'Nama file tidak valid');
  }

  await fs.promises.writeFile(destPath, buffer);
  return filename;
}

async function remove(filename) {
  if (!filename) return;
  const filePath = path.join(PRODUCTS_DIR, filename);
  if (path.dirname(filePath) !== PRODUCTS_DIR) return;

  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn({ err, filename }, 'Failed to delete product photo file');
    }
  }
}

module.exports = { PRODUCTS_DIR, save, remove };
