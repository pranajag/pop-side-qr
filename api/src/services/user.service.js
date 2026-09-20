const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { isForeignKeyError, isUniqueConstraintError } = require('../utils/prismaErrors');
const pinAttempts = require('../utils/pinAttempts');

const BCRYPT_COST = 12;
// Same rationale as auth.service.js's DUMMY_HASH — pays the same bcrypt
// cost for a user with no PIN set (or a nonexistent id) as for a real
// mismatch, so response timing can't be used to tell the two apart.
const DUMMY_PIN_HASH = bcrypt.hashSync('0000', BCRYPT_COST);

// Thrown by orderManagement.service.js's updateStatus when a paid-order
// void is attempted — a distinct type (not a bare AppError) so the caller
// can tell "wrong/missing PIN" apart from every other failure reason
// without string-matching an error message.
class PinRequiredError extends AppError {
  constructor(message) {
    super(403, message);
    this.name = 'PinRequiredError';
  }
}

// userId === null covers "no session user id was available" callers should
// never hit in practice, but keeps this safe to call defensively.
async function verifyPin(userId, pin) {
  if (pinAttempts.isLocked(userId)) {
    throw new PinRequiredError('Terlalu banyak percobaan PIN salah. Coba lagi beberapa menit lagi.');
  }
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { pinHash: true } }) : null;
  if (!user || !user.pinHash) {
    await bcrypt.compare(pin ?? '', DUMMY_PIN_HASH);
    throw new PinRequiredError('PIN belum diset untuk akun ini — minta admin set PIN dulu lewat Akun Staff.');
  }
  const matches = await bcrypt.compare(pin ?? '', user.pinHash);
  if (!matches) {
    pinAttempts.recordFailure(userId);
    throw new PinRequiredError('PIN salah.');
  }
  pinAttempts.recordSuccess(userId);
}

// Explicit allowlist, not a spread — user rows carry passwordHash/pinHash,
// which must never leave the server. hasPin (not the hash) lets the
// frontend show "PIN belum diset" without exposing anything guessable.
function toSafeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    hasPin: user.pinHash !== null,
  };
}

async function list() {
  const users = await prisma.user.findMany({ orderBy: { id: 'asc' } });
  return users.map(toSafeUser);
}

async function create(data) {
  const passwordHash = await bcrypt.hash(data.password, BCRYPT_COST);
  const pinHash = data.pin ? await bcrypt.hash(data.pin, BCRYPT_COST) : undefined;
  try {
    const user = await prisma.user.create({
      data: { username: data.username, passwordHash, pinHash, role: data.role, isActive: data.isActive },
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
  if (data.pin) {
    updateData.pinHash = await bcrypt.hash(data.pin, BCRYPT_COST);
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

module.exports = { list, create, update, remove, verifyPin, PinRequiredError };
