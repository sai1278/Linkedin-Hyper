'use strict';

const { recordDatabaseError } = require('./metrics');

const DB_READ_TIMEOUT_MS = Math.max(4_000, parseInt(process.env.DB_READ_TIMEOUT_MS || '8000', 10) || 8_000);
const DB_WRITE_TIMEOUT_MS = Math.max(4_000, parseInt(process.env.DB_WRITE_TIMEOUT_MS || '6000', 10) || 6_000);

function classifyDatabaseError(err) {
  const code = err?.code || err?.meta?.code || 'UNKNOWN_DB_ERROR';
  const message = err instanceof Error ? err.message : String(err || '');

  if (code === 'P2021') {
    return { code, message: 'Database table does not exist', unavailable: true };
  }
  if (code === 'P2022') {
    return { code, message: 'Database column does not exist', unavailable: true };
  }
  if (code === 'P1001') {
    return { code, message: "Can't reach database server", unavailable: true };
  }
  if (code === 'DB_TIMEOUT') {
    return { code, message: 'Database operation timed out', unavailable: true };
  }
  if (code === 'ECONNREFUSED') {
    return { code, message: 'Database connection refused', unavailable: true };
  }
  if (
    message.includes('ECONNREFUSED') ||
    message.includes("Can't reach database server") ||
    message.includes('does not exist in the current database') ||
    message.includes('timeout expired') ||
    message.includes('Connection terminated unexpectedly')
  ) {
    return { code, message, unavailable: true };
  }

  return { code, message, unavailable: false };
}

function isDatabaseUnavailable(err) {
  return classifyDatabaseError(err).unavailable;
}

async function withTimeout(promise, timeoutMs, code = 'DB_TIMEOUT') {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`Operation timed out after ${timeoutMs}ms`);
      err.code = code;
      reject(err);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function recordDatabaseIssue(logger, err, context = {}) {
  const classified = classifyDatabaseError(err);
  recordDatabaseError(classified.code);
  if (logger) {
    logger.warn('database.issue', {
      errorCode: classified.code,
      detail: classified.message,
      ...context,
    });
  }
  return classified;
}

module.exports = {
  DB_READ_TIMEOUT_MS,
  DB_WRITE_TIMEOUT_MS,
  classifyDatabaseError,
  isDatabaseUnavailable,
  recordDatabaseIssue,
  withTimeout,
};
