// FILE: worker/src/db/prisma.js
// Prisma Client singleton with connection pooling

'use strict';

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

let prisma = null;

/**
 * Get Prisma Client singleton instance
 * @returns {PrismaClient}
 */
function getPrisma() {
  if (!prisma) {
    const databaseUrl = process.env.DATABASE_URL;
    
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    const adapter = new PrismaPg({ connectionString: databaseUrl });

    prisma = new PrismaClient({
      adapter,
      log: process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
    });

    // Handle graceful shutdown
    process.on('beforeExit', async () => {
      await prisma.$disconnect();
    });

    console.log('[Prisma] Database client initialized');
  }

  return prisma;
}

/**
 * Disconnect Prisma Client
 */
async function disconnectPrisma() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    console.log('[Prisma] Database client disconnected');
  }
}

/**
 * Check database connection
 * @returns {Promise<boolean>}
 */
async function checkDatabaseConnection() {
  try {
    const client = getPrisma();
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error('[Prisma] Database connection check failed:', error.message);
    return false;
  }
}

module.exports = {
  getPrisma,
  disconnectPrisma,
  checkDatabaseConnection,
};
