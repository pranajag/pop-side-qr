const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');

function toShaped(tier) {
  return {
    id: tier.id,
    minPoints: tier.minPoints,
    discountPercent: Number(tier.discountPercent),
  };
}

async function list() {
  const tiers = await prisma.loyaltyTier.findMany({ orderBy: { minPoints: 'asc' } });
  return tiers.map(toShaped);
}

async function create(minPoints, discountPercent) {
  try {
    const tier = await prisma.loyaltyTier.create({ data: { minPoints, discountPercent } });
    return toShaped(tier);
  } catch (err) {
    if (err.code === 'P2002') {
      throw new AppError(409, `Sudah ada tier untuk ${minPoints} poin`);
    }
    throw err;
  }
}

async function update(id, data) {
  const existing = await prisma.loyaltyTier.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Tier tidak ditemukan');
  }
  try {
    const tier = await prisma.loyaltyTier.update({ where: { id }, data });
    return toShaped(tier);
  } catch (err) {
    if (err.code === 'P2002') {
      throw new AppError(409, `Sudah ada tier untuk ${data.minPoints} poin`);
    }
    throw err;
  }
}

async function remove(id) {
  const existing = await prisma.loyaltyTier.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Tier tidak ditemukan');
  }
  await prisma.loyaltyTier.delete({ where: { id } });
}

module.exports = { list, create, update, remove };
