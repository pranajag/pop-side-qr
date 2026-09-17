const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { isForeignKeyError } = require('../utils/prismaErrors');
const productPhoto = require('./productPhoto.service');

async function list() {
  return prisma.product.findMany({ orderBy: { id: 'asc' } });
}

async function create(data, fileBuffer) {
  const category = await prisma.category.findUnique({ where: { id: data.categoryId } });
  if (!category) {
    throw new AppError(400, 'Kategori tidak ditemukan');
  }

  const foto = fileBuffer ? await productPhoto.save(fileBuffer) : null;

  try {
    return await prisma.product.create({ data: { ...data, foto } });
  } catch (err) {
    if (foto) await productPhoto.remove(foto);
    throw err;
  }
}

async function update(id, data, fileBuffer) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Produk tidak ditemukan');
  }

  if (data.categoryId !== undefined) {
    const category = await prisma.category.findUnique({ where: { id: data.categoryId } });
    if (!category) {
      throw new AppError(400, 'Kategori tidak ditemukan');
    }
  }

  // undefined = no new file uploaded, keep the existing photo untouched
  // (as opposed to null, which would mean "clear the photo").
  const foto = fileBuffer ? await productPhoto.save(fileBuffer) : undefined;

  try {
    const updated = await prisma.product.update({
      where: { id },
      data: foto !== undefined ? { ...data, foto } : data,
    });
    if (foto && existing.foto) {
      await productPhoto.remove(existing.foto);
    }
    return updated;
  } catch (err) {
    if (foto) await productPhoto.remove(foto);
    throw err;
  }
}

async function remove(id) {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Produk tidak ditemukan');
  }

  try {
    await prisma.product.delete({ where: { id } });
  } catch (err) {
    if (isForeignKeyError(err)) {
      throw new AppError(409, 'Produk tidak bisa dihapus karena sudah pernah dipesan. Nonaktifkan lewat isAvailable saja.');
    }
    throw err;
  }

  if (existing.foto) {
    await productPhoto.remove(existing.foto);
  }
}

module.exports = { list, create, update, remove };
