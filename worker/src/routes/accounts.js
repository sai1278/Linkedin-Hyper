'use strict';

function registerAccountRoutes(app, deps) {
  const {
    listKnownAccountIds,
    withTimeout,
    accountRepo,
    dbReadTimeoutMs,
    dbWriteTimeoutMs,
    isDatabaseUnavailable,
    recordDatabaseIssue,
    sessionMeta,
    validateId,
    cleanupContext,
    saveCookies,
    deleteSession,
    hasRequiredLinkedInSessionCookies,
    clearSessionIssue,
    assertKnownAccountId,
    getLimits,
    logger,
  } = deps;

  app.get('/accounts', async (_req, res) => {
    try {
      const ids = new Set(await listKnownAccountIds());

      try {
        const dbAccounts = await withTimeout(accountRepo.getAllAccounts(), dbReadTimeoutMs);
        for (const acc of dbAccounts) {
          if (acc?.id) ids.add(acc.id);
        }
      } catch (dbErr) {
        if (!isDatabaseUnavailable(dbErr)) {
          logger.warn('accounts.list_db_read_failed', {
            errorCode: dbErr?.code || 'ACCOUNTS_DB_READ_FAILED',
            error: dbErr,
          });
        } else {
          recordDatabaseIssue(logger.child({ route: '/accounts' }), dbErr, {
            stage: 'get-all-accounts',
          });
        }
      }

      const accounts = await Promise.all(
        Array.from(ids).sort((a, b) => a.localeCompare(b)).map(async (id) => {
          const meta = await sessionMeta(id).catch(() => null);
          return {
            id,
            displayName: id,
            isActive: !!meta,
            lastSeen: meta?.savedAt ?? null,
          };
        })
      );

      res.json({ accounts });
    } catch (err) {
      res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
    }
  });

  app.post('/accounts/:accountId/session', async (req, res) => {
    try {
      const accountId = validateId(req.params.accountId, { field: 'accountId' });
      await cleanupContext(accountId).catch(() => {});
      const cookies = req.body;
      if (!Array.isArray(cookies) || cookies.length === 0 || !cookies.every((c) => c && typeof c === 'object' && !Array.isArray(c))) {
        return res.status(400).json({ error: 'Body must be a non-empty array of valid cookie objects' });
      }
      if (!hasRequiredLinkedInSessionCookies(cookies)) {
        return res.status(400).json({
          error: `Required LinkedIn cookies (li_at/JSESSIONID) are missing for account ${accountId}. Re-import cookies.`,
          code: 'COOKIES_MISSING',
        });
      }
      await saveCookies(accountId, cookies, { requireAuthCookies: true, source: 'api-import' });
      clearSessionIssue(accountId);
      try {
        await withTimeout(accountRepo.upsertAccount(accountId, accountId), dbWriteTimeoutMs);
      } catch (dbErr) {
        if (!isDatabaseUnavailable(dbErr)) {
          logger.warn('session_import.account_upsert_failed', {
            accountId,
            errorCode: dbErr?.code || 'SESSION_IMPORT_DB_WRITE_FAILED',
            error: dbErr,
          });
        } else {
          recordDatabaseIssue(logger.child({ accountId, route: '/accounts/:accountId/session' }), dbErr, {
            stage: 'session-import-upsert',
          });
        }
      }
      res.json({
        success: true,
        accountId,
        cookieCount: cookies.length,
        message: `LinkedIn cookies imported successfully for account ${accountId}. Run verify next.`,
      });
    } catch (err) {
      logger.error('session_import.failed', {
        accountId: String(req.params.accountId || ''),
        errorCode: err?.code || 'SESSION_IMPORT_FAILED',
        error: err,
      });
      res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
    }
  });

  app.get('/accounts/:accountId/session/status', async (req, res) => {
    try {
      const accountId = validateId(req.params.accountId, { field: 'accountId' });
      const meta = await sessionMeta(accountId);
      if (!meta) return res.status(404).json({ exists: false });
      res.json({ exists: true, ...meta });
    } catch (err) {
      res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
    }
  });

  app.delete('/accounts/:accountId/session', async (req, res) => {
    try {
      const accountId = validateId(req.params.accountId, { field: 'accountId' });
      await cleanupContext(accountId).catch(() => {});
      await deleteSession(accountId);
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
    }
  });

  app.get('/accounts/:accountId/limits', async (req, res) => {
    try {
      const accountId = await assertKnownAccountId(req.params.accountId);
      const limits = await getLimits(accountId);
      res.json(limits);
    } catch (err) {
      res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
    }
  });
}

module.exports = {
  registerAccountRoutes,
};
