const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const prisma = require('./prisma');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { detectImageType } = require('../utils/fileSignature');

// Shared by every image upload category (product photos, store settings'
// QRIS image, payment proof): magic-byte validated, random filename, path
// containment checked before every filesystem write (AGENTS.md upload +
// path-traversal rules). Each category gets its own subdirectory.
//
// Dua tempat penyimpanan, dipilih UPLOAD_DRIVER di .env:
//   disk (bawaan)  — api/uploads/<kategori>/, seperti AGENTS.md.
//   database       — tabel berkas_upload. Untuk hosting yang disk-nya tidak
//                    permanen (Render gratis menghapus disk setiap
//                    restart/deploy — foto menu & bukti bayar akan hilang).
// Aturan keamanannya sama persis di kedua mode: jenis file dari isinya
// (bukan nama), maks 2 MB (middleware/upload.js), nama crypto.randomUUID(),
// dan nama yang diminta harus cocok pola ketat sebelum dicari.
const MIME = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

// Filenames are always our own randomUUID() + extension (see save() below)
// — anything else, including a crafted `../` segment, is rejected before it
// ever reaches path.join/sendFile or a database lookup.
const FILENAME_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

function pakaiDatabase() {
  return (process.env.UPLOAD_DRIVER || 'disk').trim().toLowerCase() === 'database';
}

function createImageStore(subdir) {
  const dir = path.resolve(__dirname, '../../uploads', subdir);
  if (!pakaiDatabase()) fs.mkdirSync(dir, { recursive: true });

  async function save(buffer) {
    const signature = detectImageType(buffer);
    if (!signature) {
      throw new AppError(400, 'Foto harus berformat JPEG, PNG, atau WebP asli');
    }

    const filename = `${crypto.randomUUID()}${signature.ext}`;
    if (pakaiDatabase()) {
      await prisma.berkasUpload.create({
        data: { nama: filename, kategori: subdir, jenis: MIME[signature.ext], isi: buffer, ukuran: buffer.length },
      });
      return filename;
    }

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
    if (!filename || !FILENAME_PATTERN.test(filename)) return;
    if (pakaiDatabase()) {
      await prisma.berkasUpload
        .deleteMany({ where: { nama: filename, kategori: subdir } })
        .catch((err) => logger.warn({ err, filename, subdir }, 'Failed to delete uploaded file from database'));
      return;
    }
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

  // Mengirim isi file. cache 'publik' (foto menu, QRIS — boleh disimpan
  // browser & CDN setahun: namanya acak dan tidak pernah berubah isi) atau
  // 'privat' (bukti bayar — tidak boleh disimpan di mana pun).
  async function kirim(filename, res, next, { cache = 'privat' } = {}) {
    if (!FILENAME_PATTERN.test(filename)) {
      return next(new AppError(404, 'File tidak ditemukan'));
    }

    // Helmet's default Cross-Origin-Resource-Policy (same-origin) blocks
    // admin-web/public-web from loading this <img src> at all, since they
    // run on different ports/origins than the API. Safe to relax for
    // images: the caller has already applied this file's access rule
    // (public menu photo, or an authenticated staff lookup for bukti bayar).
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');

    if (pakaiDatabase()) {
      const berkas = await prisma.berkasUpload.findUnique({ where: { nama: filename } });
      if (!berkas || berkas.kategori !== subdir) {
        return next(new AppError(404, 'File tidak ditemukan'));
      }
      res.set('Content-Type', berkas.jenis);
      if (cache === 'publik') {
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        res.set('CDN-Cache-Control', 'public, max-age=31536000, immutable');
        res.set('ETag', `"${filename}"`);
        if (res.req?.headers['if-none-match'] === `"${filename}"`) return res.status(304).end();
      } else {
        res.set('Cache-Control', 'private, no-store');
      }
      return res.end(Buffer.from(berkas.isi));
    }

    const filePath = path.join(dir, filename);
    if (path.dirname(filePath) !== dir) {
      return next(new AppError(404, 'File tidak ditemukan'));
    }
    const opsi = cache === 'publik' ? { maxAge: '365d', immutable: true } : { maxAge: '0' };
    res.sendFile(filePath, opsi, (err) => {
      if (!err) return;
      next(err.code === 'ENOENT' ? new AppError(404, 'File tidak ditemukan') : err);
    });
  }

  function serve(req, res, next) {
    kirim(req.params.filename, res, next, { cache: 'publik' }).catch(next);
  }

  return { dir, save, remove, serve, kirim };
}

module.exports = { createImageStore, FILENAME_PATTERN };
