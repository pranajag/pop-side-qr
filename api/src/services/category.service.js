const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { isForeignKeyError } = require('../utils/prismaErrors');

async function list() {
  return prisma.category.findMany({ orderBy: { urutan: 'asc' } });
}

async function create(data) {
  return prisma.category.create({ data });
}

async function update(id, data) {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Kategori tidak ditemukan');
  }
  return prisma.category.update({ where: { id }, data });
}

async function remove(id) {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Kategori tidak ditemukan');
  }
  try {
    await prisma.category.delete({ where: { id } });
  } catch (err) {
    if (isForeignKeyError(err)) {
      throw new AppError(409, 'Kategori tidak bisa dihapus karena masih memiliki produk. Nonaktifkan lewat isActive saja.');
    }
    throw err;
  }
}

module.exports = { list, create, update, remove };
