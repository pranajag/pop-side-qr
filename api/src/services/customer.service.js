const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const loyaltyTierService = require('./loyaltyTier.service');

// 1 point per Rp 1.000 actually paid (post-discount) — simple, round number
// a kasir can do in their head when telling a customer what they earned.
// Applied to totalHarga (not the pre-discount subtotal): a discounted order
// should earn points on what was actually collected, not a price the
// customer didn't pay.
const RUPIAH_PER_POINT = 1000;

function pointsFor(totalHarga) {
  return Math.floor(totalHarga / RUPIAH_PER_POINT);
}

function toShaped(customer) {
  return {
    id: customer.id,
    telepon: customer.telepon,
    nama: customer.nama,
    points: customer.points,
    createdAt: customer.createdAt,
  };
}

// Called from inside order.service.js's createManualOrder transaction —
// tx, never the bare prisma client, so a customer never gets created (or
// credited points) for an order that then fails to insert for some other
// reason in the same transaction.
async function findOrCreateByPhone(tx, telepon, nama) {
  const existing = await tx.customer.findUnique({ where: { telepon } });
  if (existing) return existing;
  return tx.customer.create({ data: { telepon, nama: nama || null } });
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

  const customer = await client.customer.findUnique({ where: { telepon } });
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
async function reversePoints(tx, customerId, points) {
  if (points <= 0) return;
  const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { points: true } });
  if (!customer) return;
  await tx.customer.update({
    where: { id: customerId },
    data: { points: Math.max(0, customer.points - points) },
  });
}

async function list(search) {
  const where = search
    ? { OR: [{ telepon: { contains: search } }, { nama: { contains: search } }] }
    : {};
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
  resolveMemberDiscount,
  awardPoints,
  reversePoints,
  list,
  get,
};
