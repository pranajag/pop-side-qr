require('dotenv').config({ quiet: true });

const readline = require('node:readline');
const bcrypt = require('bcrypt');
const prisma = require('../src/lib/prisma');
const { usernameSchema, passwordSchema } = require('../src/validators/common');

// Same cost factor as user.service.js — an account made here must be
// indistinguishable from one made through the Akun Staff page.
const BCRYPT_COST = 12;

function ask(prompt, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    if (hidden) {
      // readline echoes every keystroke by default. Muting its writer is
      // what keeps the typed password off the screen, out of the terminal's
      // scrollback, and out of anything recording the session.
      rl._writeToOutput = (str) => {
        if (str.startsWith(prompt)) process.stdout.write(prompt);
      };
    }
    rl.question(prompt, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  if (!process.stdin.isTTY) {
    throw new Error(
      'Jalankan perintah ini langsung di terminal — passwordnya diketik interaktif, tidak bisa di-pipe.'
    );
  }

  console.log('Membuat akun admin baru untuk Popside.\n');

  const username = usernameSchema.parse(await ask('Username: '));

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    throw new Error(
      `Username "${username}" sudah dipakai. Ganti passwordnya lewat halaman Akun Staff, atau pilih username lain.`
    );
  }

  const password = passwordSchema.parse(
    await ask('Password (min 8 karakter, tidak ditampilkan): ', { hidden: true })
  );
  const confirm = await ask('Ulangi password: ', { hidden: true });
  if (password !== confirm) throw new Error('Password tidak sama.');

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  await prisma.user.create({
    data: { username, passwordHash, role: 'admin' },
  });

  console.log(`\nAkun admin "${username}" dibuat. Silakan login di Admin Web.`);
}

main()
  .catch((err) => {
    console.error(`\nGagal: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
