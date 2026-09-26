const { PrismaClient } = require('@prisma/client');
const { urlDenganSertifikatAbsolut } = require('../utils/urlDatabase');

const url = urlDenganSertifikatAbsolut(process.env.DATABASE_URL);
const prisma = new PrismaClient(url && url !== process.env.DATABASE_URL ? { datasourceUrl: url } : undefined);

module.exports = prisma;
