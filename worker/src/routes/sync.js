'use strict';

function registerSyncRoutes(app, deps) {
  const {
    assertKnownAccountId,
    applyRetryAfterHeader,
    syncAccount,
    syncAllAccounts,
    invalidateUnifiedInboxCache,
    markBulkSyncStarted,
    recordSyncResult,
    recordSessionExpired,
    logger,
  } = deps;

  app.post('/sync/messages', async (req, res) => {
    const log = (req.log || logger).child({ route: '/sync/messages' });

    try {
      const accountId = req.body?.accountId
        ? await assertKnownAccountId(req.body.accountId)
        : '';
      const proxyUrl = process.env.PROXY_URL || null;

      res.setTimeout(240_000, () => {
        if (!res.headersSent) res.status(504).json({ error: 'Manual sync timed out' });
      });

      log.info('sync.manual_requested', {
        accountId: accountId || 'all',
      });

      if (accountId) {
        const stats = await syncAccount(accountId, proxyUrl, { source: 'manual' });
        invalidateUnifiedInboxCache(`manual-sync:${accountId}`);

        log.info('sync.manual_completed', {
          accountId,
          stats,
        });

        return res.json({
          success: true,
          message: `Sync completed for account ${accountId}`,
          accountId,
          completed: true,
          stats,
        });
      }

      const configuredIds = (process.env.ACCOUNT_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
      markBulkSyncStarted(configuredIds, 'manual');

      syncAllAccounts(proxyUrl, { source: 'manual' })
        .then((stats) => {
          invalidateUnifiedInboxCache('manual-sync:all-accounts');
          recordSyncResult('all', true);
          log.info('sync.bulk_completed', { stats });
        })
        .catch((err) => {
          recordSyncResult('all', false);
          log.error('sync.bulk_failed', {
            errorCode: err?.code || 'SYNC_BULK_FAILED',
            error: err,
          });
        });

      return res.json({
        success: true,
        message: 'Sync started for all accounts',
      });
    } catch (err) {
      if (['SESSION_EXPIRED', 'NO_SESSION', 'AUTHENTICATED_STATE_NOT_REACHED', 'COOKIES_MISSING'].includes(err?.code)) {
        recordSessionExpired(String(req.body?.accountId || 'unknown'), err.code);
      }

      log.error('sync.manual_failed', {
        accountId: String(req.body?.accountId || 'all'),
        errorCode: err?.code || 'SYNC_FAILED',
        error: err,
      });

      const retryAfterSec = applyRetryAfterHeader(res, err);
      return res.status(err.status || 500).json({ error: err.message, code: err.code, retryAfterSec });
    }
  });
}

module.exports = {
  registerSyncRoutes,
};
