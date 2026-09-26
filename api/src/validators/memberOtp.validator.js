const { z } = require('zod');
const { memberPhoneSchema } = require('./common');

const tokenMeja = z.string().regex(/^[0-9a-f]{64}$/, 'Token meja tidak valid');
// memberPhoneSchema opsional (checkout boleh tanpa nomor); di sini wajib.
const nomorWajib = memberPhoneSchema.refine((v) => Boolean(v), 'Nomor HP wajib diisi');

const mintaOtpSchema = z.strictObject({ token: tokenMeja, customerPhone: nomorWajib });

const verifikasiOtpSchema = z.strictObject({
  token: tokenMeja,
  customerPhone: nomorWajib,
  kode: z.string().regex(/^\d{6}$/, 'Kode verifikasi 6 digit angka'),
});

module.exports = { mintaOtpSchema, verifikasiOtpSchema };
