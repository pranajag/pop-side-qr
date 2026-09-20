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

const createReservationSchema = z.object({
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
});

const updateReservationSchema = createReservationSchema.partial();

const updateReservationStatusSchema = z.object({
  status: z.enum(RESERVATION_STATUSES),
});

const setDepositPaidSchema = z.object({
  metode: z.enum(['qris', 'tunai', 'debit']),
});

module.exports = {
  createReservationSchema,
  updateReservationSchema,
  updateReservationStatusSchema,
  setDepositPaidSchema,
  RESERVATION_STATUSES,
};
