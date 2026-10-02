const prisma = require('../lib/prisma');

async function getPublicMenu() {
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: { urutan: 'asc' },
    select: {
      id: true,
      nama: true,
      // Produk yang dinonaktifkan di dashboard TETAP dikirim, ditandai
      // isAvailable: false — web menu menampilkannya abu-abu sebagai "Habis"
      // (permintaan kafe, 3 Oktober), bukan menghilangkannya. Memesannya
      // tetap ditolak di server (order.service.js / cart.service.js).
      products: {
        orderBy: { nama: 'asc' },
        select: {
          id: true,
          nama: true,
          harga: true,
          foto: true,
          isAvailable: true,
          trackStock: true,
          stok: true,
          variantGroups: {
            orderBy: { urutan: 'asc' },
            select: {
              id: true,
              nama: true,
              required: true,
              multiple: true,
              options: {
                orderBy: { urutan: 'asc' },
                select: { id: true, nama: true, hargaTambahan: true },
              },
            },
          },
        },
      },
    },
  });
}

module.exports = { getPublicMenu };
