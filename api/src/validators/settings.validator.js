const { z } = require('zod');

// Empty string from a cleared form field means "remove this" (store the
// null so the receipt stops printing that line), not "reject the request" —
// preprocessed to null before z.string() ever sees it, same pattern
// customer.service.js's customerPhone field already uses.
const emptyToNull = (schema) =>
  z.preprocess((v) => (v === '' ? null : v), schema.nullable().optional());

const updateStoreInfoSchema = z.strictObject({
  namaToko: emptyToNull(z.string().trim().max(100)),
  alamat: emptyToNull(z.string().trim().max(300)),
  telepon: emptyToNull(z.string().trim().max(30)),
  // 0-100, up to 2 decimals — a rate of e.g. 11.5% is a realistic Indonesian
  // service-charge figure, no realistic tax/service rate exceeds 100%.
  pajakPersen: z.coerce.number().min(0).max(100).optional(),
  serviceChargePersen: z.coerce.number().min(0).max(100).optional(),
});

// Its own endpoint rather than a field on updateStoreInfoSchema: the
// dashboard flips this with a single switch and must not have to resend
// (and risk clobbering) the receipt header and tax rates to do it.
const updateMemberEnabledSchema = z.strictObject({
  memberEnabled: z.boolean(),
});

// Aturan DP reservasi. Dibatasi Rp 10 juta supaya salah ketik satu nol
// berlebih tidak diam-diam jadi DP wajib seratus juta.
const updateAturanDpSchema = z.strictObject({
  nominal: z.coerce.number().int().min(0).max(10000000),
  perTamu: z.boolean(),
});

// Batas PIN konfirmasi pembayaran (Rupiah). null = PIN tidak pernah
// diminta; 0 = semua pembayaran pakai PIN.
const updatePinVerifikasiSchema = z.strictObject({
  minimal: z.coerce.number().int().min(0).max(1000000000).nullable(),
});

module.exports = { updateStoreInfoSchema, updateMemberEnabledSchema, updateAturanDpSchema, updatePinVerifikasiSchema };
