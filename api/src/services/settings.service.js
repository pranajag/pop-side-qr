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
    // Defaults to on for a store row that predates this column.
    memberEnabled: settings?.memberEnabled ?? true,
  };
}

// Read on the order/checkout path, where the only question is whether the
// loyalty feature is live at all. Its own function rather than a getSettings
// call so it can run inside an order's transaction.
async function isMemberEnabled(client) {
  const settings = await client.storeSetting.findUnique({ where: { id: 1 } });
  return settings?.memberEnabled ?? true;
}

// Aturan DP reservasi — dibaca terpisah dari toShaped() di atas, karena
// toShaped juga dikirim apa adanya ke publik lewat GET /public/settings.
// Aturan DP cuma urusan staff; tidak ada gunanya ikut terbaca siapa saja.
async function getAturanDp(client = prisma) {
  const s = await client.storeSetting.findUnique({
    where: { id: 1 },
    select: { reservasiDpNominal: true, reservasiDpPerTamu: true },
  });
  return {
    nominal: s ? Number(s.reservasiDpNominal) : 0,
    perTamu: s?.reservasiDpPerTamu ?? false,
  };
}

async function updateAturanDp({ nominal, perTamu }) {
  await prisma.storeSetting.upsert({
    where: { id: 1 },
    create: { id: 1, reservasiDpNominal: nominal, reservasiDpPerTamu: perTamu },
    update: { reservasiDpNominal: nominal, reservasiDpPerTamu: perTamu },
  });
  return getAturanDp();
}

// Batas PIN konfirmasi pembayaran — urusan staff, sama seperti aturan DP:
// tidak ikut toShaped() yang juga dikirim ke publik. Order dengan total >=
// batas ini hanya bisa dikonfirmasi lunas dengan PIN staff yang
// mengonfirmasi (orderManagement.service.js). null = PIN tidak diminta.
const BATAS_PIN_BAWAAN = 200000;

async function getPinVerifikasiMinimal(client = prisma) {
  const s = await client.storeSetting.findUnique({ where: { id: 1 }, select: { pinVerifikasiMinimal: true } });
  return s ? s.pinVerifikasiMinimal : BATAS_PIN_BAWAAN;
}

async function updatePinVerifikasi(minimal) {
  await prisma.storeSetting.upsert({
    where: { id: 1 },
    create: { id: 1, pinVerifikasiMinimal: minimal },
    update: { pinVerifikasiMinimal: minimal },
  });
  return { minimal: await getPinVerifikasiMinimal() };
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

// Tax/service charge, both optional and 0 by default. Lives here rather
// than in order.service.js because the checkout preview (cart.service.js)
// has to arrive at exactly the same number the order will be created with
// — two copies of this arithmetic would eventually quote a customer one
// total and charge them another.
//
// baseAmount is the subtotal AFTER any discount: tax and service apply to
// what is actually being charged, not to a price nobody pays. Takes a
// client so it can run inside an order's transaction or on its own.
async function computeTaxAndService(client, baseAmount) {
  const settings = await client.storeSetting.findUnique({ where: { id: 1 } });
  const pajakPersen = settings ? Number(settings.pajakPersen) : 0;
  const serviceChargePersen = settings ? Number(settings.serviceChargePersen) : 0;
  const taxAmount = Math.round(baseAmount * (pajakPersen / 100));
  const serviceChargeAmount = Math.round(baseAmount * (serviceChargePersen / 100));
  return { taxAmount, serviceChargeAmount, totalHarga: baseAmount + taxAmount + serviceChargeAmount };
}

module.exports = {
  getAturanDp,
  updateAturanDp,
  getSettings,
  isMemberEnabled,
  updateStoreInfo,
  updateQrisImage,
  computeTaxAndService,
  getPinVerifikasiMinimal,
  updatePinVerifikasi,
};
