'use strict';

function connectionKey(accountId, name, profileUrl, normalizeProfileUrlForCompare, normalizeWhitespace) {
  const normalizedUrl = normalizeProfileUrlForCompare(profileUrl);
  const normalizedName = normalizeWhitespace(name).toLowerCase();
  return `${accountId}|${normalizedUrl || normalizedName}`;
}

function pushLatestConnection(latestByConnection, item, normalizeProfileUrlForCompare, normalizeWhitespace) {
  if (!item?.accountId) return;
  const key = connectionKey(item.accountId, item.name, item.profileUrl, normalizeProfileUrlForCompare, normalizeWhitespace);
  const previous = latestByConnection.get(key);
  const currentTs = Number(item.connectedAt) || 0;
  const previousTs = Number(previous?.connectedAt) || 0;
  if (!previous || currentTs >= previousTs) {
    latestByConnection.set(key, item);
  }
}

function mapActivityEntryToConnection(accountId, entry, normalizeParticipantName) {
  if (!entry || entry.type !== 'connectionSent') {
    return null;
  }
  const profileUrl = String(entry.targetProfileUrl || '');
  const name = normalizeParticipantName(entry.targetName, profileUrl);
  if (!name || name === 'Unknown') return null;

  return {
    accountId,
    name,
    profileUrl,
    connectedAt: Number(entry.timestamp) || Date.now(),
    source: entry.type,
  };
}

function finalizeUnifiedConnections(latestByConnection, limit = 300) {
  return Array.from(latestByConnection.values())
    .sort((a, b) => {
      const tsDiff = (Number(b.connectedAt) || 0) - (Number(a.connectedAt) || 0);
      if (tsDiff !== 0) return tsDiff;
      return String(a.name || '').localeCompare(String(b.name || ''));
    })
    .slice(0, limit);
}

function mergeConnectionList(latestByConnection, items = [], normalizeParticipantName, normalizeProfileUrlForCompare, normalizeWhitespace) {
  for (const item of items || []) {
    const profileUrl = String(item?.profileUrl || '');
    const name = normalizeParticipantName(item?.name, profileUrl);
    if (!name || name === 'Unknown') continue;

    pushLatestConnection(latestByConnection, {
      accountId: item.accountId,
      name,
      profileUrl,
      headline: item?.headline || '',
      connectedAt: Number(item?.connectedAt) || undefined,
      source: item?.source || 'linkedin',
    }, normalizeProfileUrlForCompare, normalizeWhitespace);
  }
}

function registerConnectionRoutes(app, deps) {
  const {
    assertKnownAccountId,
    validateProfileUrl,
    sanitizeNote,
    runJob,
    readConnections,
    listKnownAccountIds,
    getRecentActivityEntries,
    normalizeParticipantName,
    normalizeProfileUrlForCompare,
    normalizeWhitespace,
    sessionMeta,
    getHealthStateSnapshot,
    applyRetryAfterHeader,
    toPublicOperationError,
    logger,
  } = deps;

  const CONNECTION_LIVE_SCRAPE_SESSION_COOLDOWN_MS = Math.max(
    0,
    parseInt(
      process.env.CONNECTION_LIVE_SCRAPE_SESSION_COOLDOWN_MS || String(15 * 60_000),
      10
    ) || 15 * 60_000
  );
  const UNIFIED_CONNECTIONS_CACHE_TTL_MS = 300_000;
  let unifiedConnectionsCache = {
    expiresAt: 0,
    payload: { connections: [] },
  };
  let unifiedConnectionsInFlight = null;

  async function seedUnifiedConnectionsFromActivity() {
    const ids = await listKnownAccountIds();
    const latestByConnection = new Map();

    for (const accountId of ids) {
      const activityEntries = await getRecentActivityEntries(accountId, 1000);
      for (const entry of activityEntries) {
        const mapped = mapActivityEntryToConnection(accountId, entry, normalizeParticipantName);
        if (mapped) {
          pushLatestConnection(latestByConnection, { ...mapped }, normalizeProfileUrlForCompare, normalizeWhitespace);
        }
      }
    }

    return { ids, latestByConnection };
  }

  async function getLiveScrapeEligibleAccountIds(accountIds = []) {
    const healthState = getHealthStateSnapshot();
    const eligible = [];

    for (const accountId of accountIds) {
      const state = healthState.accounts[accountId] || {};
      if (state.sessionIssue) {
        logger.warn('connections.live_scrape_skipped_issue', {
          accountId,
          code: state.sessionIssue.code || 'unknown',
        });
        continue;
      }

      const meta = await sessionMeta(accountId).catch(() => null);
      const ageMs = Number(meta?.ageSeconds) > 0 ? Number(meta.ageSeconds) * 1000 : 0;
      if (
        CONNECTION_LIVE_SCRAPE_SESSION_COOLDOWN_MS > 0 &&
        ageMs > 0 &&
        ageMs < CONNECTION_LIVE_SCRAPE_SESSION_COOLDOWN_MS
      ) {
        logger.warn('connections.live_scrape_skipped_recent_session', {
          accountId,
          sessionAgeSeconds: Math.round(ageMs / 1000),
        });
        continue;
      }

      eligible.push(accountId);
    }

    return eligible;
  }

  async function buildUnifiedConnections(limit = 300, { includeLive = true } = {}) {
    const { ids, latestByConnection } = await seedUnifiedConnectionsFromActivity();

    if (!includeLive) {
      return { connections: finalizeUnifiedConnections(latestByConnection, limit) };
    }

    const eligibleIds = await getLiveScrapeEligibleAccountIds(ids);
    if (eligibleIds.length === 0) {
      return { connections: finalizeUnifiedConnections(latestByConnection, limit) };
    }

    const proxyUrl = process.env.PROXY_URL || null;
    const liveResults = await Promise.allSettled(
      eligibleIds.map(async (accountId) => {
        try {
          const result = await runJob(
            'readConnections',
            { accountId, proxyUrl, limit: Math.min(limit, 200) },
            90_000
          );
          return { accountId, items: result?.items || [] };
        } catch (queueErr) {
          const msg = queueErr instanceof Error ? queueErr.message : String(queueErr);
          const isRedisConnectivityError =
            msg.includes('Connection is closed') ||
            msg.includes('ECONNREFUSED') ||
            msg.includes('ENOTFOUND') ||
            msg.includes('getaddrinfo');

          if (!isRedisConnectivityError) {
            throw queueErr;
          }

          const directResult = await readConnections({
            accountId,
            proxyUrl,
            limit: Math.min(limit, 200),
          });
          return { accountId, items: directResult?.items || [] };
        }
      })
    );

    for (const result of liveResults) {
      if (result.status !== 'fulfilled') {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        logger.warn('connections.live_scrape_failed', { detail: reason });
        continue;
      }

      mergeConnectionList(
        latestByConnection,
        (result.value.items || []).map((item) => ({
          ...item,
          accountId: result.value.accountId,
          source: 'linkedin',
        })),
        normalizeParticipantName,
        normalizeProfileUrlForCompare,
        normalizeWhitespace
      );
    }

    return { connections: finalizeUnifiedConnections(latestByConnection, limit) };
  }

  async function getUnifiedConnectionsWithCache(limit = 300, { refresh = false } = {}) {
    if (refresh) {
      unifiedConnectionsCache.expiresAt = 0;
    }

    if (!refresh) {
      const latestByConnection = new Map();
      mergeConnectionList(
        latestByConnection,
        unifiedConnectionsCache.payload.connections || [],
        normalizeParticipantName,
        normalizeProfileUrlForCompare,
        normalizeWhitespace
      );

      const activityPayload = await buildUnifiedConnections(limit, { includeLive: false });
      mergeConnectionList(
        latestByConnection,
        activityPayload.connections || [],
        normalizeParticipantName,
        normalizeProfileUrlForCompare,
        normalizeWhitespace
      );

      return { connections: finalizeUnifiedConnections(latestByConnection, limit) };
    }

    unifiedConnectionsInFlight = (async () => {
      const payload = await buildUnifiedConnections(limit, { includeLive: true });
      unifiedConnectionsCache = {
        expiresAt: Date.now() + UNIFIED_CONNECTIONS_CACHE_TTL_MS,
        payload,
      };
      return payload;
    })();

    try {
      const payload = await unifiedConnectionsInFlight;
      return { connections: payload.connections.slice(0, limit) };
    } finally {
      unifiedConnectionsInFlight = null;
    }
  }

  app.post('/connections/send', async (req, res) => {
    try {
      const accountId = await assertKnownAccountId(req.body?.accountId);
      const profileUrl = validateProfileUrl(req.body?.profileUrl);
      const note = req.body?.note == null ? '' : sanitizeNote(req.body.note);

      const result = await runJob('sendConnectionRequest', {
        accountId,
        profileUrl,
        note,
        proxyUrl: process.env.PROXY_URL || null,
      }, 90_000);
      res.json(result);
    } catch (err) {
      const status = err.status || (err.message ? 400 : 500);
      res.status(status).json({
        error: toPublicOperationError(err),
        code: err.code,
      });
    }
  });

  app.get('/connections/unified', async (req, res) => {
    try {
      const limit = deps.parseLimit(req.query.limit, 300, 1000);
      const refresh = String(req.query.refresh || '') === '1';
      const payload = await getUnifiedConnectionsWithCache(limit, { refresh });
      res.json(payload);
    } catch (err) {
      if (err?.status) {
        const retryAfterSec = applyRetryAfterHeader(res, err);
        return res.status(err.status).json({
          error: toPublicOperationError(err),
          code: err.code,
          retryAfterSec,
        });
      }

      logger.error('connections.unified_failed', {
        errorCode: err?.code || 'UNIFIED_CONNECTIONS_FAILED',
        error: err,
      });
      res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
    }
  });
}

module.exports = {
  registerConnectionRoutes,
};
