const { z } = require('zod');

const tanggal = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD').optional();

const auditLogQuerySchema = z.strictObject({
  dari: tanggal,
  sampai: tanggal,
  userId: z.coerce.number().int().positive().optional(),
  hasil: z.enum(['berhasil', 'ditolak']).optional(),
  halaman: z.coerce.number().int().min(1).max(100000).default(1),
});

module.exports = { auditLogQuerySchema };
