const { Prisma } = require('@prisma/client');

function isForeignKeyError(err) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
}

function isUniqueConstraintError(err) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

module.exports = { isForeignKeyError, isUniqueConstraintError };
