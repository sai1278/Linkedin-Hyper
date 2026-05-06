'use strict';

function createHealthSummaryService(deps) {
  const {
    getRedis,
    withTimeout,
    accountRepo,
    dbReadTimeoutMs,
    getKnownAccountIdsSet,
    sessionMeta,
    getHealthStateSnapshot,
  } = deps;

  function deriveHealthSeverity({ hasSession, sessionIssue, lastSyncStatus, lastSyncedAt, staleThresholdMs }) {
    if (!hasSession) return 'critical';
    if (sessionIssue) return 'critical';
    if (lastSyncStatus === 'failed') return 'critical';
    if (lastSyncStatus === 'warning') return 'warning';
    if (lastSyncStatus === 'running') return 'warning';
    if (lastSyncedAt && Date.now() - lastSyncedAt > staleThresholdMs) return 'warning';
    return 'healthy';
  }

  async function buildHealthSummary() {
    const syncIntervalMinutes = Math.max(1, parseInt(process.env.SYNC_INTERVAL_MINUTES || '10', 10) || 10);
    const staleThresholdMs = syncIntervalMinutes * 60_000 * 3;
    const healthState = getHealthStateSnapshot();
    const knownIds = Array.from(await getKnownAccountIdsSet()).sort((a, b) => a.localeCompare(b));

    let dbAccounts = [];
    try {
      dbAccounts = await withTimeout(accountRepo.getAllAccounts(), dbReadTimeoutMs);
    } catch (err) {
      if (!deps.isDatabaseUnavailable(err)) {
        throw err;
      }
    }

    const dbAccountsById = new Map(
      (dbAccounts || []).map((account) => [String(account?.id || '').trim(), account])
    );

    const accounts = await Promise.all(
      knownIds.map(async (accountId) => {
        const meta = await sessionMeta(accountId).catch(() => null);
        const state = healthState.accounts[accountId] || {};
        const dbAccount = dbAccountsById.get(accountId);
        const lastSyncedAt = dbAccount?.lastSyncedAt ? new Date(dbAccount.lastSyncedAt).getTime() : null;
        const hasSession = Boolean(meta?.savedAt);
        const severity = deriveHealthSeverity({
          hasSession,
          sessionIssue: state.sessionIssue,
          lastSyncStatus: state.lastSyncStatus,
          lastSyncedAt,
          staleThresholdMs,
        });

        return {
          accountId,
          displayName: String(dbAccount?.displayName || accountId),
          hasSession,
          lastSessionSavedAt: Number(meta?.savedAt) || null,
          sessionAgeSeconds: Number(meta?.ageSeconds) || null,
          lastSyncedAt,
          lastSyncStatus: state.lastSyncStatus || 'idle',
          lastSyncSource: state.lastSyncSource || null,
          lastSyncStartedAt: Number(state.lastSyncStartedAt) || null,
          lastSyncCompletedAt: Number(state.lastSyncCompletedAt) || null,
          lastSyncError: state.lastSyncError || null,
          lastSyncStats: state.lastSyncStats || null,
          sessionIssue: state.sessionIssue || null,
          severity,
        };
      })
    );

    const alerts = [];
    for (const account of accounts) {
      if (!account.hasSession) {
        alerts.push({
          id: `session-missing-${account.accountId}`,
          severity: 'critical',
          kind: 'session',
          accountId: account.accountId,
          title: `${account.displayName}: session missing`,
          message: 'Open Accounts and import fresh LinkedIn cookies before sending or syncing.',
        });
        continue;
      }

      if (account.sessionIssue) {
        alerts.push({
          id: `session-issue-${account.accountId}`,
          severity: 'critical',
          kind: 'session',
          accountId: account.accountId,
          title: `${account.displayName}: session needs attention`,
          message: account.sessionIssue.message,
        });
      }

      if (account.lastSyncStatus === 'failed') {
        alerts.push({
          id: `sync-failed-${account.accountId}`,
          severity: 'critical',
          kind: 'sync',
          accountId: account.accountId,
          title: `${account.displayName}: sync failed`,
          message: account.lastSyncError || 'The latest sync did not complete successfully.',
        });
      } else if (
        account.lastSyncedAt &&
        Date.now() - account.lastSyncedAt > staleThresholdMs
      ) {
        alerts.push({
          id: `sync-stale-${account.accountId}`,
          severity: 'warning',
          kind: 'sync',
          accountId: account.accountId,
          title: `${account.displayName}: sync looks stale`,
          message: `No successful sync recorded in the last ${syncIntervalMinutes * 3} minutes.`,
        });
      }
    }

    const totals = {
      totalAccounts: accounts.length,
      accountsWithSession: accounts.filter((account) => account.hasSession).length,
      accountsNeedingAttention: accounts.filter((account) => account.severity !== 'healthy').length,
      criticalAlerts: alerts.filter((alert) => alert.severity === 'critical').length,
      warningAlerts: alerts.filter((alert) => alert.severity === 'warning').length,
    };

    return {
      status: totals.criticalAlerts > 0 ? 'critical' : totals.warningAlerts > 0 ? 'warning' : 'healthy',
      generatedAt: Date.now(),
      syncIntervalMinutes,
      totals,
      alerts,
      accounts,
      bulkSync: healthState.bulkSync,
    };
  }

  async function buildStartupValidationReport() {
    const checks = [];
    const redis = getRedis();

    try {
      const result = await withTimeout(redis.ping(), 2000, 'REDIS_TIMEOUT');
      checks.push({
        id: 'redis',
        label: 'Redis connectivity',
        status: String(result).toUpperCase() === 'PONG' ? 'pass' : 'fail',
        detail: String(result),
      });
    } catch (err) {
      checks.push({
        id: 'redis',
        label: 'Redis connectivity',
        status: 'fail',
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const dbAccounts = await withTimeout(accountRepo.getAllAccounts(), dbReadTimeoutMs);
      checks.push({
        id: 'database',
        label: 'Database connectivity',
        status: 'pass',
        detail: `${dbAccounts.length} account row(s) readable`,
      });
    } catch (err) {
      checks.push({
        id: 'database',
        label: 'Database connectivity',
        status: 'fail',
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    let knownIds = [];
    try {
      knownIds = Array.from(await getKnownAccountIdsSet());
      checks.push({
        id: 'accounts',
        label: 'Configured account registry',
        status: knownIds.length > 0 ? 'pass' : 'warn',
        detail: knownIds.length > 0 ? `${knownIds.length} account(s) available` : 'No accounts configured yet',
      });
    } catch (err) {
      checks.push({
        id: 'accounts',
        label: 'Configured account registry',
        status: 'fail',
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    let sessionCount = 0;
    for (const accountId of knownIds) {
      const meta = await sessionMeta(accountId).catch(() => null);
      if (meta?.savedAt) {
        sessionCount += 1;
      }
    }

    checks.push({
      id: 'sessions',
      label: 'Imported LinkedIn sessions',
      status: sessionCount > 0 ? 'pass' : (knownIds.length > 0 ? 'warn' : 'pass'),
      detail: knownIds.length > 0
        ? `${sessionCount}/${knownIds.length} account(s) have saved cookies`
        : 'No accounts configured yet',
    });

    checks.push({
      id: 'scheduler',
      label: 'Automatic sync scheduler',
      status: process.env.DISABLE_MESSAGE_SYNC === '1' ? 'warn' : 'pass',
      detail: process.env.DISABLE_MESSAGE_SYNC === '1'
        ? 'DISABLE_MESSAGE_SYNC=1'
        : `Runs every ${Math.max(1, parseInt(process.env.SYNC_INTERVAL_MINUTES || '10', 10) || 10)} minute(s)`,
    });

    const healthSummary = await buildHealthSummary();

    return {
      status: checks.some((check) => check.status === 'fail')
        ? 'fail'
        : checks.some((check) => check.status === 'warn')
          ? 'warn'
          : 'pass',
      generatedAt: Date.now(),
      checks,
      healthSummary: {
        status: healthSummary.status,
        criticalAlerts: healthSummary.totals.criticalAlerts,
        warningAlerts: healthSummary.totals.warningAlerts,
        accountsNeedingAttention: healthSummary.totals.accountsNeedingAttention,
      },
    };
  }

  return {
    buildHealthSummary,
    buildStartupValidationReport,
  };
}

module.exports = {
  createHealthSummaryService,
};
