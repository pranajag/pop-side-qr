const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const settingsImage = require('./settingsImage.service');

function toShaped(settings) {
  return {
    qrisImage: settings?.qrisImage ?? null,
    namaToko: settings?.namaToko ?? null,
    alamat: settings?.alamat ?? null,
    telepon: settings?.telepon ?? null,
    pajakPersen: settings ? Number(settings.pajakPersen) : 0,
    serviceChargePersen: settings ? Number(settings.serviceChargePersen) : 0,
  };
}

async function getSettings() {
  const settings = await prisma.storeSetting.findUnique({ where: { id: 1 } });
  return toShaped(settings);
}

// Receipt header + tax/service rate — separate from updateQrisImage below
// since this is a plain JSON PUT (no file), not worth folding into the
// same multipart endpoint.
async function updateStoreInfo(data) {
  const updated = await prisma.storeSetting.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });
  return toShaped(updated);
}

async function updateQrisImage(fileBuffer) {
  if (!fileBuffer) {
    throw new AppError(400, 'Foto QRIS wajib diunggah');
  }

  const existing = await prisma.storeSetting.findUnique({ where: { id: 1 } });
  const filename = await settingsImage.save(fileBuffer);

  try {
    const updated = await prisma.storeSetting.upsert({
      where: { id: 1 },
      create: { id: 1, qrisImage: filename },
      update: { qrisImage: filename },
    });
    if (existing?.qrisImage) {
      await settingsImage.remove(existing.qrisImage);
    }
    return toShaped(updated);
  } catch (err) {
    await settingsImage.remove(filename);
    throw err;
  }
}

module.exports = { getSettings, updateStoreInfo, updateQrisImage };
