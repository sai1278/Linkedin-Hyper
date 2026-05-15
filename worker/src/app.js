'use strict';

const express = require('express');
const { getQueue, getQueueEvents, getQueueStats } = require('./queue');
const { listKnownAccountIds, saveCookies, sessionMeta, deleteSession, hasRequiredLinkedInSessionCookies } = require('./session');
const { verifySession } = require('./actions/login');
const { readMessages } = require('./actions/readMessages');
const { readConnections } = require('./actions/readConnections');
const { readThread } = require('./actions/readThread');
const { runNamedJob } = require('./jobRunner');
const { getLimits } = require('./rateLimit');
const { createRequestLoggerMiddleware, logger } = require('./utils/logger');
const { getMetricsSnapshot, recordMessageSent, recordSendFailure, recordSessionExpired, recordSyncResult } = require('./utils/metrics');
const { DB_READ_TIMEOUT_MS, DB_WRITE_TIMEOUT_MS, isDatabaseUnavailable, recordDatabaseIssue, withTimeout } = require('./utils/database');
const { getRedis, getRedisRuntimeState } = require('./redisClient');
const { cleanupContext, getBrowserStats, isBrowserManagerReady } = require('./browser');
const { registerPublicHealthRoute, registerInternalHealthRoutes } = require('./routes/health');
const { registerMetricsRoutes } = require('./routes/metrics');
const { registerSyncRoutes } = require('./routes/sync');
const { registerInboxRoutes } = require('./routes/inbox');
const { registerSendRoutes } = require('./routes/send');
const { registerAccountRoutes } = require('./routes/accounts');
const { registerVerifyRoutes } = require('./routes/verify');
const { registerThreadRoutes } = require('./routes/threads');
const { registerConnectionRoutes } = require('./routes/connections');
const { registerStatsRoutes } = require('./routes/stats');
const { registerSearchRoutes } = require('./routes/search');
const { createInboxFallbackService } = require('./services/inboxFallbackService');
const { createHealthSummaryService } = require('./services/healthSummary');
const { createAccountRegistry } = require('./services/accountRegistry');
const { createJobRunner } = require('./services/jobExecutionService');
const {
  normalizeWhitespace,
  isGenericUiLabel,
  normalizeParticipantName,
  normalizeProfileUrlForCompare,
  dedupeRecentActivity,
  getRecentActivityEntries,
} = require('./services/presentationHelpers');
const { normalizeThreadId, mergePublicMessages } = require('./services/threadMessageHelpers');
const { requireApiKey, applyRetryAfterHeader, toPublicOperationError } = require('./services/requestHelpers');
const { sanitizeText, sanitizeNote, validateId, validateProfileUrl, parseLimit } = require('./sanitizers');
const { getWorkerStatus } = require('./worker');
const accountRepo = require('./db/repositories/AccountRepository');
const messageRepo = require('./db/repositories/MessageRepository');
const exportRoutes = require('./routes/export');
const { syncAccount, syncAllAccounts } = require('./services/messageSyncService');
const { clearSessionIssue, getHealthStateSnapshot, markBulkSyncStarted, markSessionIssue } = require('./healthState');

function createApp() {
  const app = express();

  if (process.env.ACCOUNT_IDS) {
    const ids = process.env.ACCOUNT_IDS.split(',');
    if (ids.some((id) => !id || !id.trim())) {
      throw new Error('ACCOUNT_IDS contains empty string segments. Check for trailing commas.');
    }
  }

  app.use(createRequestLoggerMiddleware());
  app.use(express.json({ limit: '2mb' }));

  app.use((err, _req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({ error: 'Invalid JSON body. Ensure request payload is valid JSON.' });
    }
    return next(err);
  });

  app.use((req, res, next) => {
    res.setTimeout(130_000, () => {
      if (!res.headersSent) res.status(504).json({ error: 'Request timed out' });
    });
    next();
  });

  const jobRunner = createJobRunner({
    getQueue,
    getQueueEvents,
    runNamedJob,
  });

  const accountRegistry = createAccountRegistry({
    listKnownAccountIds,
    accountRepo,
    withTimeout,
    isDatabaseUnavailable,
    validateId,
    dbReadTimeoutMs: DB_READ_TIMEOUT_MS,
    normalizeThreadId,
    messageRepo,
  });

  const inboxFallbackService = createInboxFallbackService({
    logger,
    getRedis,
    listKnownAccountIds,
    readMessages,
    normalizeParticipantName,
    normalizeWhitespace,
    normalizeProfileUrlForCompare,
    mergePublicMessages,
    withTimeout,
    recordSessionExpired,
    markSessionIssue,
    clearSessionIssue,
    messageRepo,
    normalizeThreadId,
    dbWriteTimeoutMs: DB_WRITE_TIMEOUT_MS,
    isDatabaseUnavailable,
    recordDatabaseIssue,
  });

  const healthSummaryService = createHealthSummaryService({
    getRedis,
    withTimeout,
    accountRepo,
    dbReadTimeoutMs: DB_READ_TIMEOUT_MS,
    getKnownAccountIdsSet: accountRegistry.getKnownAccountIdsSet,
    sessionMeta,
    getHealthStateSnapshot,
    isDatabaseUnavailable,
  });

  registerPublicHealthRoute(app, {
    getRedis,
    getRedisRuntimeState,
    withTimeout,
    accountRepo,
    getWorkerStatus,
    getBrowserStats,
    isBrowserManagerReady,
    getQueueStats,
    logger,
  });

  app.use(requireApiKey);
  app.use('/export', exportRoutes);

  registerInternalHealthRoutes(app, {
    buildHealthSummary: healthSummaryService.buildHealthSummary,
    buildStartupValidationReport: healthSummaryService.buildStartupValidationReport,
    logger,
  });

  registerMetricsRoutes(app, {
    getMetricsSnapshot,
    getBrowserStats,
    getWorkerStatus,
    getQueueStats,
  });

  registerSyncRoutes(app, {
    assertKnownAccountId: accountRegistry.assertKnownAccountId,
    applyRetryAfterHeader,
    syncAccount,
    syncAllAccounts,
    invalidateUnifiedInboxCache: inboxFallbackService.invalidateUnifiedInboxCache,
    markBulkSyncStarted,
    recordSyncResult,
    recordSessionExpired,
    logger,
  });

  registerAccountRoutes(app, {
    listKnownAccountIds,
    withTimeout,
    accountRepo,
    dbReadTimeoutMs: DB_READ_TIMEOUT_MS,
    dbWriteTimeoutMs: DB_WRITE_TIMEOUT_MS,
    isDatabaseUnavailable,
    recordDatabaseIssue,
    sessionMeta,
    validateId,
    cleanupContext,
    saveCookies,
    deleteSession,
    hasRequiredLinkedInSessionCookies,
    clearSessionIssue,
    assertKnownAccountId: accountRegistry.assertKnownAccountId,
    getLimits,
    logger,
  });

  registerVerifyRoutes(app, {
    assertKnownAccountId: accountRegistry.assertKnownAccountId,
    verifySession,
    clearSessionIssue,
    markSessionIssue,
    toPublicOperationError,
  });

  registerThreadRoutes(app, {
    messageRepo,
    withTimeout,
    isDatabaseUnavailable,
    recordDatabaseIssue,
    readTimeoutMs: DB_READ_TIMEOUT_MS,
    writeTimeoutMs: DB_WRITE_TIMEOUT_MS,
    assertKnownAccountId: accountRegistry.assertKnownAccountId,
    assertConversationBelongsToAccount: accountRegistry.assertConversationBelongsToAccount,
    validateId,
    parseLimit,
    getRedis,
    normalizeParticipantName,
    normalizeWhitespace,
    isGenericUiLabel,
    dedupeInFlightFallback: inboxFallbackService.dedupeInFlightFallback,
    liveThreadFallbacksInFlight: inboxFallbackService.liveThreadFallbacksInFlight,
    runJob: jobRunner.runJob,
    readThread,
    logger,
    toPublicOperationError,
  });

  registerConnectionRoutes(app, {
    assertKnownAccountId: accountRegistry.assertKnownAccountId,
    validateProfileUrl,
    sanitizeNote,
    runJob: jobRunner.runJob,
    readConnections,
    listKnownAccountIds,
    getRecentActivityEntries: (accountId, limit) => getRecentActivityEntries(getRedis, accountId, limit),
    normalizeParticipantName,
    normalizeProfileUrlForCompare,
    normalizeWhitespace,
    sessionMeta,
    getHealthStateSnapshot,
    applyRetryAfterHeader,
    toPublicOperationError,
    logger,
    parseLimit,
  });

  registerInboxRoutes(app, {
    messageRepo,
    parseLimit,
    withTimeout,
    isDatabaseUnavailable,
    buildUnifiedInboxFromActivity: inboxFallbackService.buildUnifiedInboxFromActivity,
    dedupeAndSortConversations: inboxFallbackService.dedupeAndSortConversations,
    buildUnifiedInboxWithFallback: inboxFallbackService.buildUnifiedInboxWithFallback,
    getUnifiedInboxCacheState: inboxFallbackService.getUnifiedInboxCacheState,
    recordDatabaseIssue,
    applyRetryAfterHeader,
    toPublicOperationError,
    logger,
    readTimeoutMs: DB_READ_TIMEOUT_MS,
  });

  registerSendRoutes(app, {
    logger,
    assertKnownAccountId: accountRegistry.assertKnownAccountId,
    validateProfileUrl,
    assertConversationBelongsToAccount: accountRegistry.assertConversationBelongsToAccount,
    sanitizeText,
    runJob: jobRunner.runJob,
    cleanupContext,
    normalizeProfileUrlForCompare,
    normalizeThreadId,
    persistOptimisticSendNewResult: inboxFallbackService.persistOptimisticSendNewResult,
    recordMessageSent,
    applyRetryAfterHeader,
    recordSendFailure,
    recordSessionExpired,
    toPublicOperationError,
  });

  registerStatsRoutes(app, {
    getRedis,
    dedupeRecentActivity,
    getRecentActivityEntries: (accountId, limit) => getRecentActivityEntries(getRedis, accountId, limit),
    normalizeParticipantName,
    assertKnownAccountId: accountRegistry.assertKnownAccountId,
    logger,
  });

  registerSearchRoutes(app, {
    assertKnownAccountId: accountRegistry.assertKnownAccountId,
    sanitizeText,
    runJob: jobRunner.runJob,
    toPublicOperationError,
  });

  return app;
}

module.exports = {
  createApp,
};
