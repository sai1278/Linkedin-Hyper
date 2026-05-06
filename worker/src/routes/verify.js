'use strict';

function registerVerifyRoutes(app, deps) {
  const {
    assertKnownAccountId,
    verifySession,
    clearSessionIssue,
    markSessionIssue,
    toPublicOperationError,
  } = deps;

  app.post('/accounts/:accountId/verify', async (req, res) => {
    try {
      const accountId = await assertKnownAccountId(req.params.accountId);
      const proxyUrl = process.env.PROXY_URL || null;
      res.setTimeout(230_000, () => {
        if (!res.headersSent) res.status(504).json({ error: 'Request timed out' });
      });

      const result = await verifySession({ accountId, proxyUrl });
      clearSessionIssue(accountId);
      res.json({
        ...result,
        message: `LinkedIn session verification succeeded for account ${accountId}.`,
      });
    } catch (err) {
      if ([
        'NO_SESSION',
        'SESSION_EXPIRED',
        'AUTHENTICATED_STATE_NOT_REACHED',
        'COOKIES_MISSING',
        'CHECKPOINT_INCOMPLETE',
        'LOGIN_NOT_FINISHED',
        'NAVIGATION_REDIRECT_LOOP',
      ].includes(err?.code)) {
        markSessionIssue(req.params.accountId, {
          code: err.code,
          message: toPublicOperationError(err),
        });
      }
      if (res.headersSent) {
        return;
      }
      const status = err.status || (err.message ? 400 : 500);
      res.status(status).json({
        error: toPublicOperationError(err),
        code: err.code,
      });
    }
  });
}

module.exports = {
  registerVerifyRoutes,
};
