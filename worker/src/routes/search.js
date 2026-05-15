'use strict';

function registerSearchRoutes(app, deps) {
  const {
    assertKnownAccountId,
    sanitizeText,
    runJob,
    toPublicOperationError,
  } = deps;

  app.get('/people/search', async (req, res) => {
    try {
      const accountId = await assertKnownAccountId(req.query.accountId);
      const { limit } = req.query;
      const query = sanitizeText(req.query.q, { maxLength: 200 });
      if (!query) return res.status(400).json({ error: 'q is required' });

      const result = await runJob('searchPeople', {
        accountId,
        query,
        limit: parseInt(limit || '10', 10),
        proxyUrl: process.env.PROXY_URL || null,
      });
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({
        error: toPublicOperationError(err),
        code: err.code,
      });
    }
  });
}

module.exports = {
  registerSearchRoutes,
};
