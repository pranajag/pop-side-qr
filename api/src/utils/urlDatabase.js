const path = require('node:path');

const FOLDER_PRISMA = path.resolve(__dirname, '..', '..', 'prisma');

// URL database hosting memuat sertifikat CA sebagai path relatif
// (sslcert=./aiven-ca.pem, scripts/siapkan-produksi.js). CLI Prisma
// (migrate) membacanya relatif terhadap folder prisma/, tapi Prisma Client
// saat runtime tidak selalu begitu — tergantung OS dan folder kerja proses
// (prisma/prisma#24647). Untuk Prisma Client, path-nya dibuat absolut di
// sini supaya sama di laptop (Windows) maupun di server hosting (Linux).
// Spasi di path (folder project di laptop) di-percent-encode; Prisma
// men-decode nilai query URL.
function urlDenganSertifikatAbsolut(url) {
  if (typeof url !== 'string') return url;
  return url.replace(/([?&]sslcert=)(\.{1,2}\/[^&]+)/, (_, kunci, relatif) => {
    const absolut = path.resolve(FOLDER_PRISMA, decodeURIComponent(relatif));
    return kunci + encodeURI(absolut.split(path.sep).join('/'));
  });
}

module.exports = { urlDenganSertifikatAbsolut };
