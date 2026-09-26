const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const loyaltyTierService = require('./loyaltyTier.service');
const settingsService = require('./settings.service');
const { normalisasiTelepon, POLA_TELEPON } = require('../validators/common');
const { dekripsi, sidikTelepon, kolomTelepon } = require('../utils/kripto');

// 1 point per Rp 1.000 actually paid (post-discount) — simple, round number
// a kasir can do in their head when telling a customer what they earned.
// Applied to totalHarga (not the pre-discount subtotal): a discounted order
// should earn points on what was actually collected, not a price the
// customer didn't pay.
const RUPIAH_PER_POINT = 1000;

function pointsFor(totalHarga) {
  return Math.floor(totalHarga / RUPIAH_PER_POINT);
}

// Nomor HP disimpan terenkripsi (utils/kripto.js) — dibuka hanya di sini,
// untuk ditampilkan ke staff yang login (halaman Member).
function toShaped(customer) {
  return {
    id: customer.id,
    telepon: dekripsi(customer.teleponEnc),
    nama: customer.nama,
    points: customer.points,
    createdAt: customer.createdAt,
  };
}

// Called from inside order.service.js's createManualOrder transaction —
// tx, never the bare prisma client, so a customer never gets created (or
// credited points) for an order that then fails to insert for some other
// reason in the same transaction.
//
// Member yang pertama terdaftar lewat scan QR cuma punya nomor — checkout
// publik memang tidak menanyakan nama. Begitu staff mengetik namanya di
// Pesanan Manual, nama itu mengisi yang kosong. Hanya mengisi, tidak pernah
// menimpa nama yang sudah ada: bisa saja salah ketik di kasir, atau satu
// nomor dipakai bergantian sekeluarga.
async function findOrCreateByPhone(tx, telepon, nama) {
  const namaBersih = typeof nama === 'string' ? nama.trim() : '';
  const existing = await tx.customer.findUnique({ where: { teleponHash: sidikTelepon(telepon) } });
  if (existing) {
    if (!existing.nama?.trim() && namaBersih) {
      return tx.customer.update({ where: { id: existing.id }, data: { nama: namaBersih } });
    }
    return existing;
  }
  return tx.customer.create({ data: { ...kolomTelepon(telepon), nama: namaBersih || null } });
}

// Member untuk nomor ini, tanpa membuatnya. Dicari lewat sidik (HMAC), jadi
// nomornya sendiri tidak pernah dipakai sebagai kunci query.
async function findByPhone(client, telepon) {
  if (!telepon) return null;
  return client.customer.findUnique({ where: { teleponHash: sidikTelepon(telepon) } });
}

// The member discount a phone number is entitled to on an order of this
// size. Lookup only — never creates the customer, because this also runs
// for the pre-order preview on the checkout screen, where nothing has been
// ordered yet.
//
// The percentage comes from the admin-configured tier matching the
// customer's stored points, never from anything the client sends: the
// browser only ever supplies a phone number, so a customer still cannot set
// their own price (AGENTS.md). Points are a *threshold* here, not a
// currency — qualifying for a tier doesn't spend them, same as the
// staff-applied discount in Pesanan Manual.
async function resolveMemberDiscount(client, telepon, subtotal) {
  const none = { customer: null, tier: null, discountAmount: 0 };
  if (!telepon) return none;

  // Checked here rather than only at the call sites so the master switch
  // can't be bypassed by a future caller that forgets it: with loyalty off,
  // a phone number buys nothing no matter who asks.
  if (!(await settingsService.isMemberEnabled(client))) return none;

  const customer = await findByPhone(client, telepon);
  if (!customer) return none;

  const tier = await loyaltyTierService.applicableTier(client, customer.points);
  if (!tier) return { customer, tier: null, discountAmount: 0 };

  // Capped at the subtotal so a misconfigured tier can never drive the
  // total negative, even though the validator already caps the percentage
  // far below 100.
  const discountAmount = Math.min(
    Math.round(subtotal * (tier.discountPercent / 100)),
    subtotal
  );
  return { customer, tier, discountAmount };
}

async function awardPoints(tx, customerId, points) {
  if (points <= 0) return;
  await tx.customer.update({ where: { id: customerId }, data: { points: { increment: points } } });
}

// Called from orderManagement.service.js's updateStatus when a paid order
// with a linked customer is voided. Floored at 0 rather than letting a
// single clawback push the balance negative — if some of those points were
// already redeemed via a later, unrelated order's discount, that's a
// separate reconciliation a human should look at, not something this
// clawback should silently paper over with a negative balance.
//
// Satu pernyataan UPDATE, bukan baca-lalu-tulis: kalau order lain milik
// member yang sama sedang dikonfirmasi bersamaan (awardPoints menambah
// poin), versi baca-lalu-tulis bisa menimpa tambahan itu dengan saldo
// lama. updated_at diisi UTC_TIMESTAMP karena Prisma menyimpan semua
// DateTime dalam UTC.
async function reversePoints(tx, customerId, points) {
  if (points <= 0) return;
  await tx.$executeRaw`UPDATE customers SET points = GREATEST(points - ${points}, 0), updated_at = UTC_TIMESTAMP(3) WHERE id = ${customerId}`;
}

async function list(search) {
  // Nomor HP tersimpan terenkripsi, jadi pencarian nomor hanya bisa dua cara:
  //   - nomor lengkap, ditulis bagaimana pun ("0812 3456 7890", "+62812…")
  //     -> dibakukan dulu (validators/common.js), dicari lewat sidiknya;
  //   - 1-4 digit -> dicocokkan ke 4 digit terakhir nomor ("7890", "890").
  // Potongan awal/tengah nomor ("0812") memang tidak bisa dicari lagi — itu
  // harga dari tidak menyimpan nomor polos. Nama tetap dicari apa adanya.
  const kata = typeof search === 'string' ? search.trim() : '';
  let where = {};
  if (kata) {
    const atau = [{ nama: { contains: kata } }];
    if (/^[\d\s\-.()+]+$/.test(kata)) {
      const baku = normalisasiTelepon(kata);
      if (POLA_TELEPON.test(baku)) atau.push({ teleponHash: sidikTelepon(baku) });
      const digit = kata.replace(/\D/g, '');
      if (digit.length >= 1 && digit.length <= 4) atau.push({ teleponAkhir: { endsWith: digit } });
    }
    where = { OR: atau };
  }
  const customers = await prisma.customer.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 100 });
  return customers.map(toShaped);
}

async function get(id) {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, kodeOrder: true, status: true, totalHarga: true, pointsEarned: true, createdAt: true },
      },
    },
  });
  if (!customer) {
    throw new AppError(404, 'Member tidak ditemukan');
  }
  return {
    ...toShaped(customer),
    orders: customer.orders.map((o) => ({
      id: o.id,
      kodeOrder: o.kodeOrder,
      status: o.status,
      totalHarga: Number(o.totalHarga),
      pointsEarned: o.pointsEarned,
      createdAt: o.createdAt,
    })),
  };
}

module.exports = {
  pointsFor,
  findOrCreateByPhone,
  findByPhone,
  resolveMemberDiscount,
  awardPoints,
  reversePoints,
  list,
  get,
};
