const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const settingsImage = require('./settingsImage.service');

async function getSettings() {
  const settings = await prisma.storeSetting.findUnique({ where: { id: 1 } });
  return { qrisImage: settings?.qrisImage ?? null };
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
    return updated;
  } catch (err) {
    await settingsImage.remove(filename);
    throw err;
  }
}

module.exports = { getSettings, updateQrisImage };
