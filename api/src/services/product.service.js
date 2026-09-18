const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { isForeignKeyError } = require('../utils/prismaErrors');
const productPhoto = require('./productPhoto.service');

const VARIANT_INCLUDE = {
  variantGroups: {
    orderBy: { urutan: 'asc' },
    include: { options: { orderBy: { urutan: 'asc' } } },
  },
};

function toNestedVariantCreate(groups) {
  return groups.map((group, groupIdx) => ({
    nama: group.nama,
    required: group.required,
    multiple: group.multiple,
    urutan: groupIdx,
    options: {
      create: group.options.map((option, optionIdx) => ({
        nama: option.nama,
        hargaTambahan: option.hargaTambahan,
        urutan: optionIdx,
      })),
    },
  }));
}

async function list() {
  return prisma.product.findMany({ orderBy: { id: 'asc' }, include: VARIANT_INCLUDE });
}

async function create(data, fileBuffer) {
  const { variantGroups, ...fields } = data;

  const category = await prisma.category.findUnique({ where: { id: fields.categoryId } });
  if (!category) {
    throw new AppError(400, 'Kategori tidak ditemukan');
  }

  const foto = fileBuffer ? await productPhoto.save(fileBuffer) : null;

  try {
    return await prisma.product.create({
      data: {
        ...fields,
        foto,
        variantGroups: variantGroups?.length ? { create: toNestedVariantCreate(variantGroups) } : undefined,
      },
      include: VARIANT_INCLUDE,
    });
  } catch (err) {
    if (foto) await productPhoto.remove(foto);
    throw err;
  }
}

async function update(id, data, fileBuffer) {
  const { variantGroups, ...fields } = data;

  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Produk tidak ditemukan');
  }

  if (fields.categoryId !== undefined) {
    const category = await prisma.category.findUnique({ where: { id: fields.categoryId } });
    if (!category) {
      throw new AppError(400, 'Kategori tidak ditemukan');
    }
  }

  // undefined = no new file uploaded, keep the existing photo untouched
  // (as opposed to null, which would mean "clear the photo").
  const foto = fileBuffer ? await productPhoto.save(fileBuffer) : undefined;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // variantGroups omitted entirely (undefined) = leave variants as they
      // are. Any array, including [], means "replace with exactly this" —
      // simplest correct way to handle add/rename/remove/reorder in one
      // shot without diffing, and safe because OrderItemVariant snapshots
      // group/option name+price directly rather than holding a live FK, so
      // deleting old VariantGroup/Option rows never touches past orders.
      if (variantGroups !== undefined) {
        await tx.variantGroup.deleteMany({ where: { productId: id } });
      }
      return tx.product.update({
        where: { id },
        data: {
          ...fields,
          ...(foto !== undefined ? { foto } : {}),
          ...(variantGroups !== undefined && variantGroups.length
            ? { variantGroups: { create: toNestedVariantCreate(variantGroups) } }
            : {}),
        },
        include: VARIANT_INCLUDE,
      });
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
