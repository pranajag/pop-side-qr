const { z } = require('zod');

const RESERVATION_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'];

// tableId is optional at booking time (staff may log a reservation before
// deciding which table to assign) — empty string from a cleared select
// means "no table yet", mapped to null so update() can actually clear a
// previously-set tableId instead of leaving it untouched (undefined means
// "don't touch" to Prisma's update).
const tableIdSchema = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.coerce.number().int().positive().nullable()
);

const reservationFields = z.strictObject({
  namaCustomer: z.string().trim().min(1).max(100),
  namaAcara: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(100).optional()),
  telepon: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(20).optional()),
  jumlahTamu: z.coerce.number().int().min(1).max(999),
  tanggalReservasi: z.coerce.date(),
  tableId: tableIdSchema.optional(),
  catatan: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(300).optional()),
  // Deposit/DP to secure the booking — optional, 0 (no deposit) unless
  // staff sets one. Empty string from a cleared form field means "no
  // deposit", not "reject the request".
  depositAmount: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.coerce.number().int().min(0).max(999999999).optional()
  ),
  // Wajib (dan hanya admin yang boleh) kalau DP wajib di bawah aturan toko —
  // reservation.service.js yang menentukan, karena hanya ia yang tahu
  // aturan DP-nya.
  alasanDp: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().trim().min(3).max(200).optional()),
});

const METODE = ['qris', 'tunai', 'debit'];

// Saat membuat reservasi, staff boleh langsung mencatat DP yang dibayar
// customer saat itu juga (kasus paling umum: pesan meja sekaligus bayar DP).
// Hanya di create — pembayaran berikutnya lewat POST /:id/pembayaran-dp,
// supaya edit data reservasi tidak pernah diam-diam menambah uang masuk.
const createReservationSchema = reservationFields
  .extend({
    dpDibayarSekarang: z.preprocess(
      (v) => (v === '' || v === undefined || v === null ? undefined : v),
      z.coerce.number().int().min(0).max(999999999).optional()
    ),
    metodeDp: z.preprocess(
      (v) => (v === '' || v === null ? undefined : v),
      z.enum(METODE).optional()
    ),
  })
  .superRefine((val, ctx) => {
    if ((val.dpDibayarSekarang ?? 0) > 0 && !val.metodeDp) {
      ctx.addIssue({ code: 'custom', path: ['metodeDp'], message: 'Pilih metode pembayaran DP' });
    }
  });

const updateReservationSchema = reservationFields.partial();

const updateReservationStatusSchema = z.strictObject({
  status: z.enum(RESERVATION_STATUSES),
});

const catatPembayaranDpSchema = z.strictObject({
  amount: z.coerce.number().int().min(1).max(999999999),
  metode: z.enum(METODE),
});

module.exports = {
  createReservationSchema,
  updateReservationSchema,
  updateReservationStatusSchema,
  catatPembayaranDpSchema,
  RESERVATION_STATUSES,
};
