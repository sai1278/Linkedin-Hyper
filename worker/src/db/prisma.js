// FILE: worker/src/db/prisma.js
// Prisma Client singleton with connection pooling

'use strict';

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { logger } = require('../utils/logger');
const { recordDatabaseError } = require('../utils/metrics');

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

    logger.info('prisma.client_initialized');
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
    logger.info('prisma.client_disconnected');
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
    recordDatabaseError(error?.code || 'PRISMA_CHECK_FAILED');
    logger.error('prisma.connection_check_failed', {
      errorCode: error?.code || 'PRISMA_CHECK_FAILED',
      error,
    });
    return false;
  }
}

module.exports = {
  getPrisma,
  disconnectPrisma,
  checkDatabaseConnection,
};
