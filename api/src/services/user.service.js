const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { isForeignKeyError, isUniqueConstraintError } = require('../utils/prismaErrors');

const BCRYPT_COST = 12;

// Explicit allowlist, not a spread — user rows carry passwordHash, which
// must never leave the server.
function toSafeUser(user) {
  return { id: user.id, username: user.username, role: user.role, isActive: user.isActive };
}

async function list() {
  const users = await prisma.user.findMany({ orderBy: { id: 'asc' } });
  return users.map(toSafeUser);
}

async function create(data) {
  const passwordHash = await bcrypt.hash(data.password, BCRYPT_COST);
  try {
    const user = await prisma.user.create({
      data: { username: data.username, passwordHash, role: data.role, isActive: data.isActive },
    });
    return toSafeUser(user);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new AppError(409, 'Username sudah dipakai');
    }
    throw err;
  }
}

async function update(id, actorId, data) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Akun tidak ditemukan');
  }
  // A solo admin editing their own account could otherwise lock themselves
  // out mid-session (demote to kasir, or deactivate) with no one left who
  // can undo it — simplest safe rule is to never allow either on yourself,
  // regardless of how many other admins currently exist.
  if (id === actorId && (data.isActive === false || (data.role && data.role !== existing.role))) {
    throw new AppError(400, 'Tidak bisa mengubah role atau menonaktifkan akun sendiri');
  }

  const updateData = { username: data.username, role: data.role, isActive: data.isActive };
  if (data.password) {
    updateData.passwordHash = await bcrypt.hash(data.password, BCRYPT_COST);
  }

  try {
    const user = await prisma.user.update({ where: { id }, data: updateData });
    return toSafeUser(user);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new AppError(409, 'Username sudah dipakai');
    }
    throw err;
  }
}

async function remove(id, actorId) {
  if (id === actorId) {
    throw new AppError(400, 'Tidak bisa menghapus akun sendiri');
  }
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Akun tidak ditemukan');
  }
  try {
    await prisma.user.delete({ where: { id } });
  } catch (err) {
    if (isForeignKeyError(err)) {
      throw new AppError(409, 'Akun tidak bisa dihapus karena sudah memiliki riwayat aktivitas. Nonaktifkan lewat isActive saja.');
    }
    throw err;
  }
}

module.exports = { list, create, update, remove };
