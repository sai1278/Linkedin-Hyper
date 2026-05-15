'use strict';

const syncStateByAccount = new Map();
let bulkSyncState = {
  status: 'idle',
  source: 'system',
  startedAt: null,
  completedAt: null,
  totalAccounts: 0,
  successfulAccounts: 0,
  totalErrors: 0,
  error: null,
};

function getOrCreateAccountState(accountId) {
  const key = String(accountId || '').trim();
  if (!key) {
    return null;
  }

  if (!syncStateByAccount.has(key)) {
    syncStateByAccount.set(key, {
      lastSyncStatus: 'idle',
      lastSyncSource: null,
      lastSyncStartedAt: null,
      lastSyncCompletedAt: null,
      lastSyncError: null,
      lastSyncStats: null,
      sessionIssue: null,
      updatedAt: null,
    });
  }

  return syncStateByAccount.get(key);
}

function markSyncStarted(accountId, source = 'scheduler') {
  const state = getOrCreateAccountState(accountId);
  if (!state) return;

  state.lastSyncStatus = 'running';
  state.lastSyncSource = source;
  state.lastSyncStartedAt = Date.now();
  state.lastSyncError = null;
  state.updatedAt = Date.now();
}

function markSyncCompleted(accountId, stats = {}, source = 'scheduler') {
  const state = getOrCreateAccountState(accountId);
  if (!state) return;

  const hasErrors = Array.isArray(stats?.errors) && stats.errors.length > 0;
  state.lastSyncStatus = hasErrors ? 'warning' : 'success';
  state.lastSyncSource = source;
  state.lastSyncCompletedAt = Date.now();
  state.lastSyncError = hasErrors
    ? String(stats.errors[0]?.error || stats.errors[0]?.message || 'Sync completed with warnings')
    : null;
  state.lastSyncStats = {
    conversationsProcessed: Number(stats?.conversationsProcessed) || 0,
    newMessages: Number(stats?.newMessages) || 0,
    errors: Array.isArray(stats?.errors) ? stats.errors.length : 0,
  };
  state.updatedAt = Date.now();
}

function markSyncFailed(accountId, error, source = 'scheduler') {
  const state = getOrCreateAccountState(accountId);
  if (!state) return;

  state.lastSyncStatus = 'failed';
  state.lastSyncSource = source;
  state.lastSyncCompletedAt = Date.now();
  state.lastSyncError = error instanceof Error ? error.message : String(error || 'Sync failed');
  state.updatedAt = Date.now();
}

function markBulkSyncStarted(accountIds = [], source = 'scheduler') {
  bulkSyncState = {
    status: 'running',
    source,
    startedAt: Date.now(),
    completedAt: null,
    totalAccounts: Array.isArray(accountIds) ? accountIds.length : 0,
    successfulAccounts: 0,
    totalErrors: 0,
    error: null,
  };
}

function markBulkSyncCompleted(result = {}, source = 'scheduler') {
  bulkSyncState = {
    status: Number(result?.totalErrors) > 0 ? 'warning' : 'success',
    source,
    startedAt: bulkSyncState.startedAt || Date.now(),
    completedAt: Date.now(),
    totalAccounts: Number(result?.totalAccounts) || 0,
    successfulAccounts: Number(result?.successfulAccounts) || 0,
    totalErrors: Number(result?.totalErrors) || 0,
    error: null,
  };
}

function markBulkSyncFailed(error, source = 'scheduler') {
  bulkSyncState = {
    status: 'failed',
    source,
    startedAt: bulkSyncState.startedAt || Date.now(),
    completedAt: Date.now(),
    totalAccounts: bulkSyncState.totalAccounts || 0,
    successfulAccounts: 0,
    totalErrors: bulkSyncState.totalErrors || 1,
    error: error instanceof Error ? error.message : String(error || 'Bulk sync failed'),
  };
}

function markSessionIssue(accountId, issue) {
  const state = getOrCreateAccountState(accountId);
  if (!state) return;

  const normalizedIssue = issue || {};
  state.sessionIssue = {
    code: String(normalizedIssue.code || 'SESSION_ATTENTION'),
    message: String(normalizedIssue.message || 'Session needs attention'),
    detectedAt: Date.now(),
  };
  state.updatedAt = Date.now();
}

function clearSessionIssue(accountId) {
  const state = getOrCreateAccountState(accountId);
  if (!state) return;

  state.sessionIssue = null;
  state.updatedAt = Date.now();
}

function getHealthStateSnapshot() {
  const accounts = {};
  for (const [accountId, state] of syncStateByAccount.entries()) {
    accounts[accountId] = {
      ...state,
      lastSyncStats: state.lastSyncStats ? { ...state.lastSyncStats } : null,
      sessionIssue: state.sessionIssue ? { ...state.sessionIssue } : null,
    };
  }

  return {
    generatedAt: Date.now(),
    bulkSync: { ...bulkSyncState },
    accounts,
  };
}

module.exports = {
  clearSessionIssue,
  getHealthStateSnapshot,
  markBulkSyncCompleted,
  markBulkSyncFailed,
  markBulkSyncStarted,
  markSessionIssue,
  markSyncCompleted,
  markSyncFailed,
  markSyncStarted,
};
