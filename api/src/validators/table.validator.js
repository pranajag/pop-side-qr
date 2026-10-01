const { z } = require('zod');
const { zBooleanish } = require('./common');

const createTableSchema = z.strictObject({
  nomorMeja: z.string().trim().min(1).max(20),
  isActive: zBooleanish.default(true),
  kapasitas: z.coerce.number().int().min(1).max(999).default(4),
});

const updateTableSchema = createTableSchema.partial();

const setBillOpenSchema = z.strictObject({
  isBillOpen: zBooleanish,
});

// Web publik: `?r=` = token QR rombongan reservasi (table.service.js
// computeTokenRombongan) — hanya dibawa oleh QR dari tombol "Mulai Pesanan".
const aksesMejaQuerySchema = z.strictObject({
  r: z.string().regex(/^[0-9a-f]{64}$/, 'Token rombongan tidak valid').optional(),
});

module.exports = { createTableSchema, updateTableSchema, setBillOpenSchema, aksesMejaQuerySchema };
