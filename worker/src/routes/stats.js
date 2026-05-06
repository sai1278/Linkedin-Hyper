'use strict';

function registerStatsRoutes(app, deps) {
  const {
    getRedis,
    dedupeRecentActivity,
    getRecentActivityEntries,
    normalizeParticipantName,
    assertKnownAccountId,
    logger,
  } = deps;

  app.get('/stats/all/summary', async (_req, res) => {
    try {
      const ids = (process.env.ACCOUNT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const redis = getRedis();

      let totalMessages = 0;
      let totalConnections = 0;
      const recentActivityEntries = [];

      const accountStats = await Promise.all(
        ids.map(async (id) => {
          const [msgs, conns] = await Promise.all([
            redis.get(`stats:messages:${id}`).catch(() => '0'),
            redis.get(`stats:connections:${id}`).catch(() => '0'),
          ]);
          const parsedMsgs = parseInt(msgs || '0', 10);
          const parsedConns = parseInt(conns || '0', 10);
          totalMessages += parsedMsgs;
          totalConnections += parsedConns;

          const activityEntries = await getRecentActivityEntries(id, 50);
          for (const entry of activityEntries) {
            if (!['messageSent', 'connectionSent', 'profileViewed'].includes(entry?.type)) {
              continue;
            }

            const profileUrl = String(entry.targetProfileUrl || '');
            recentActivityEntries.push({
              ...entry,
              targetName: normalizeParticipantName(entry.targetName, profileUrl),
              message:
                typeof entry.message === 'string' && entry.message.trim()
                  ? entry.message
                  : (typeof entry.textPreview === 'string' ? entry.textPreview : undefined),
            });
          }

          return { id, totalActivity: parsedMsgs + parsedConns };
        })
      );

      const recentActivity = dedupeRecentActivity(recentActivityEntries)
        .sort((a, b) => (Number(b?.timestamp) || 0) - (Number(a?.timestamp) || 0))
        .slice(0, 10);

      res.json({
        accounts: Object.fromEntries(accountStats.map((account) => [account.id, account])),
        totalMessages,
        totalConnections,
        totalActivity: totalMessages + totalConnections,
        recentActivity,
      });
    } catch (err) {
      logger.error('stats.all_summary_failed', {
        errorCode: err?.code || 'STATS_ALL_SUMMARY_FAILED',
        error: err,
      });
      res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
    }
  });

  app.get('/stats/:accountId/summary', async (req, res) => {
    try {
      const accountId = await assertKnownAccountId(req.params.accountId);
      const redis = getRedis();
      const key = `activity:log:${accountId}`;
      const total = await redis.llen(key).catch(() => 0);
      res.json({ accountId, totalActivity: total });
    } catch (err) {
      res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
    }
  });

  app.get('/stats/:accountId/activity', async (req, res) => {
    try {
      const accountId = await assertKnownAccountId(req.params.accountId);
      const page = parseInt(req.query.page ?? '0', 10);
      const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
      const redis = getRedis();
      const key = `activity:log:${accountId}`;
      const total = await redis.llen(key).catch(() => 0);
      const start = page * limit;
      const stop = start + limit - 1;
      const raw = await redis.lrange(key, start, stop).catch(() => []);

      const entries = raw.map((row) => {
        try {
          return JSON.parse(row);
        } catch {
          return null;
        }
      }).filter(Boolean).map((entry) => {
        const profileUrl = String(entry.targetProfileUrl || '');
        return {
          ...entry,
          targetName: normalizeParticipantName(entry.targetName, profileUrl),
          message:
            typeof entry.message === 'string' && entry.message.trim()
              ? entry.message
              : (typeof entry.textPreview === 'string' ? entry.textPreview : undefined),
        };
      });

      const optimizedEntries = dedupeRecentActivity(entries).slice(0, limit);
      res.json({ entries: optimizedEntries, total });
    } catch (err) {
      res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
    }
  });
}

module.exports = {
  registerStatsRoutes,
};
