'use strict';

const { logger } = require('./logger');

const COOLDOWN_MS = Math.max(
  15_000,
  parseInt(process.env.DB_SCRAPE_CIRCUIT_COOLDOWN_MS || '120000', 10) || 120_000
);

let circuitState = {
  openUntil: 0,
  lastFailureAt: 0,
  lastFailureCode: null,
  lastFailureMessage: null,
};

function noteDatabaseUnavailable(error, context = {}) {
  const message = error instanceof Error ? error.message : String(error || 'Database unavailable');
  circuitState = {
    openUntil: Date.now() + COOLDOWN_MS,
    lastFailureAt: Date.now(),
    lastFailureCode: String(error?.code || 'DB_UNAVAILABLE'),
    lastFailureMessage: message,
  };

  logger.warn('database.circuit_opened', {
    errorCode: circuitState.lastFailureCode,
    detail: message,
    cooldownMs: COOLDOWN_MS,
    ...context,
  });
}

function noteDatabaseHealthy() {
  if (Date.now() >= circuitState.openUntil && !circuitState.lastFailureAt) {
    return;
  }

  circuitState = {
    openUntil: 0,
    lastFailureAt: 0,
    lastFailureCode: null,
    lastFailureMessage: null,
  };
}

function getDatabaseCircuitState() {
  return { ...circuitState };
}

function assertDatabaseReadyForScrape(context = {}) {
  if (Date.now() >= circuitState.openUntil) {
    return;
  }

  const remainingMs = Math.max(0, circuitState.openUntil - Date.now());
  const err = new Error(
    `Database is degraded. Skipping LinkedIn scrape until database health stabilizes. Retry in ${Math.ceil(remainingMs / 1000)}s.`
  );
  err.code = 'DB_CIRCUIT_OPEN';
  err.status = 503;
  err.retryAfterSec = Math.max(1, Math.ceil(remainingMs / 1000));
  err.detail = circuitState.lastFailureMessage;
  err.context = context;
  throw err;
}

module.exports = {
  assertDatabaseReadyForScrape,
  getDatabaseCircuitState,
  noteDatabaseHealthy,
  noteDatabaseUnavailable,
};
