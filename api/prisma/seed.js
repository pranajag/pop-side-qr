require('dotenv').config({ quiet: true });

const bcrypt = require('bcrypt');
const prisma = require('../src/lib/prisma');

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';
  const kasirPassword = process.env.SEED_KASIR_PASSWORD || 'ChangeMe123!';

  const adminHash = await bcrypt.hash(adminPassword, 12);
  const kasirHash = await bcrypt.hash(kasirPassword, 12);

  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: { username: 'admin', passwordHash: adminHash, role: 'admin' },
  });

  await prisma.user.upsert({
    where: { username: 'kasir1' },
    update: {},
    create: { username: 'kasir1', passwordHash: kasirHash, role: 'kasir' },
  });

  console.log('Seeded: admin, kasir1');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
