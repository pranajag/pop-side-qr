const prisma = require('../lib/prisma');

async function getPublicMenu() {
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: { urutan: 'asc' },
    select: {
      id: true,
      nama: true,
      products: {
        where: { isAvailable: true },
        orderBy: { nama: 'asc' },
        select: { id: true, nama: true, harga: true, foto: true, trackStock: true, stok: true },
      },
    },
  });
}

module.exports = { getPublicMenu };
