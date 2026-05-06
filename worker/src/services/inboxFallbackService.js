'use strict';

function createInboxFallbackService(deps) {
  const {
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
    dbWriteTimeoutMs,
    isDatabaseUnavailable,
    recordDatabaseIssue,
  } = deps;

  const UNIFIED_INBOX_CACHE_TTL_MS = 60_000;
  let unifiedInboxCache = {
    expiresAt: 0,
    payload: { conversations: [] },
  };
  let unifiedInboxInFlight = null;
  const liveThreadFallbacksInFlight = new Map();

  function buildPreviewMessagesFromInboxItem(accountId, item, rawConversationId, participantName) {
    const previewText = normalizeWhitespace(item?.lastMessage?.text || '');
    if (!previewText) {
      return [];
    }

    const createdAt = item?.lastMessage?.createdAt || item?.createdAt || new Date().toISOString();
    const sentAt = Number(new Date(createdAt).getTime()) || Date.now();
    const sentByMe = item?.lastMessage?.senderId === '__self__';

    return [{
      id: `preview-${rawConversationId}-${sentAt}`,
      chatId: rawConversationId,
      senderId: sentByMe ? '__self__' : 'other',
      text: previewText,
      createdAt,
      sentAt,
      isSentByMe: sentByMe,
      senderName: sentByMe ? accountId : participantName,
    }];
  }

  function invalidateUnifiedInboxCache(reason = 'unspecified') {
    unifiedInboxCache = {
      expiresAt: 0,
      payload: { conversations: [] },
    };
    unifiedInboxInFlight = null;
    logger.debug('inbox.cache_invalidated', { reason });
  }

  function getUnifiedInboxCacheState() {
    return {
      expiresAt: unifiedInboxCache.expiresAt,
      payload: {
        conversations: Array.isArray(unifiedInboxCache.payload?.conversations)
          ? [...unifiedInboxCache.payload.conversations]
          : [],
      },
    };
  }

  async function dedupeInFlightFallback(map, key, factory) {
    if (map.has(key)) {
      return map.get(key);
    }

    const promise = (async () => factory())();
    map.set(key, promise);

    try {
      return await promise;
    } finally {
      if (map.get(key) === promise) {
        map.delete(key);
      }
    }
  }

  function normalizeConversationFromInboxItem(accountId, item) {
    const participantProfileUrl = String(item?.participants?.[0]?.profileUrl || '');
    const participantName = normalizeParticipantName(item?.participants?.[0]?.name, participantProfileUrl);
    const participantAvatarUrl = String(item?.participants?.[0]?.avatarUrl || '');
    const rawId = String(item?.id || `unknown-${Date.now()}`);
    const createdAt = item?.lastMessage?.createdAt || item?.createdAt || new Date().toISOString();
    const sentAt = Number(new Date(createdAt).getTime()) || Date.now();
    const previewMessages = buildPreviewMessagesFromInboxItem(accountId, item, rawId, participantName);

    return {
      conversationId: `${accountId}:${rawId}`,
      accountId,
      participant: {
        name: participantName,
        profileUrl: participantProfileUrl,
        avatarUrl: participantAvatarUrl || null,
      },
      lastMessage: {
        text: String(item?.lastMessage?.text || ''),
        sentAt,
        sentByMe: item?.lastMessage?.senderId === '__self__',
      },
      unreadCount: Number(item?.unreadCount) || 0,
      messages: previewMessages,
      degraded: true,
    };
  }

  function getConversationSentAt(conv) {
    return Number(conv?.lastMessage?.sentAt) || 0;
  }

  function getConversationText(conv) {
    return normalizeWhitespace(conv?.lastMessage?.text || '');
  }

  function getConversationProfileUrl(conv) {
    return normalizeProfileUrlForCompare(conv?.participant?.profileUrl || '');
  }

  function getConversationAvatarUrl(conv) {
    return String(conv?.participant?.avatarUrl || '').trim();
  }

  function getConversationNameToken(conv) {
    return normalizeWhitespace(conv?.participant?.name || '').toLowerCase();
  }

  function conversationQualityScore(conv) {
    const hasProfile = Boolean(getConversationProfileUrl(conv));
    const hasText = Boolean(getConversationText(conv));
    const hasMessages = Array.isArray(conv?.messages) && conv.messages.length > 0;
    const conversationId = String(conv?.conversationId || '');
    const isFallbackId = conversationId.startsWith('fallback-');
    const isActivityId = conversationId.startsWith('activity-');

    let score = 0;
    if (hasProfile) score += 40;
    if (hasText) score += 20;
    if (hasMessages) score += 10;
    if (isActivityId) score += 5;
    if (isFallbackId) score -= 15;
    return score;
  }

  function isLowSignalFallbackConversation(conv) {
    const conversationId = String(conv?.conversationId || '');
    const hasProfile = Boolean(getConversationProfileUrl(conv));
    const hasText = Boolean(getConversationText(conv));
    return conversationId.startsWith('fallback-') && !hasProfile && !hasText;
  }

  function conversationThreadStabilityScore(conv) {
    const conversationId = String(conv?.conversationId || '');
    if (!conversationId) return 0;
    if (conversationId.startsWith('activity-')) return 1;
    if (conversationId.startsWith('fallback-')) return 0;
    return 3;
  }

  function mergeConversationMessages(previous, current) {
    return mergePublicMessages(
      previous?.messages || [],
      current?.messages || [],
      {
        accountId: current?.accountId || previous?.accountId || '',
        conversationId: current?.conversationId || previous?.conversationId || '',
      },
      'mergeConversationMessages'
    );
  }

  function mergeConversations(previous, current) {
    const previousStability = conversationThreadStabilityScore(previous);
    const currentStability = conversationThreadStabilityScore(current);

    let canonical = previous;
    if (
      currentStability > previousStability ||
      (
        currentStability === previousStability &&
        conversationQualityScore(current) > conversationQualityScore(previous)
      )
    ) {
      canonical = current;
    }

    const previousSentAt = getConversationSentAt(previous);
    const currentSentAt = getConversationSentAt(current);
    const latest = currentSentAt >= previousSentAt ? current : previous;
    const messages = mergeConversationMessages(previous, current);

    const canonicalParticipant = canonical?.participant || {};
    const latestParticipant = latest?.participant || {};
    const fallbackParticipant = previous === canonical ? current?.participant || {} : previous?.participant || {};

    return {
      ...canonical,
      participant: {
        ...canonicalParticipant,
        name:
          canonicalParticipant.name ||
          latestParticipant.name ||
          fallbackParticipant.name ||
          'Unknown',
        profileUrl:
          canonicalParticipant.profileUrl ||
          latestParticipant.profileUrl ||
          fallbackParticipant.profileUrl ||
          '',
        avatarUrl:
          canonicalParticipant.avatarUrl ||
          latestParticipant.avatarUrl ||
          fallbackParticipant.avatarUrl ||
          null,
      },
      lastMessage: latest?.lastMessage || canonical?.lastMessage,
      unreadCount: Math.max(Number(previous?.unreadCount) || 0, Number(current?.unreadCount) || 0),
      messages,
      degraded: Boolean(previous?.degraded || current?.degraded),
    };
  }

  function dedupeAndSortConversations(conversations) {
    const profileAliasByName = new Map();
    const avatarAliasByName = new Map();

    for (const conv of conversations) {
      if (!conv?.accountId) continue;
      const profileUrl = getConversationProfileUrl(conv);
      const avatarUrl = getConversationAvatarUrl(conv);
      const nameToken = getConversationNameToken(conv);
      if (!profileUrl || !nameToken) continue;

      const aliasKey = `${conv.accountId}|${nameToken}`;
      const previous = profileAliasByName.get(aliasKey);
      if (!previous || getConversationSentAt(conv) >= previous.sentAt) {
        profileAliasByName.set(aliasKey, {
          profileUrl,
          sentAt: getConversationSentAt(conv),
        });
      }

      if (avatarUrl) {
        const previousAvatar = avatarAliasByName.get(aliasKey);
        if (!previousAvatar || getConversationSentAt(conv) >= previousAvatar.sentAt) {
          avatarAliasByName.set(aliasKey, {
            avatarUrl,
            sentAt: getConversationSentAt(conv),
          });
        }
      }
    }

    const latestByConversation = new Map();

    for (const conv of conversations) {
      if (!conv?.accountId) continue;

      const nameToken = getConversationNameToken(conv);
      const directProfileUrl = getConversationProfileUrl(conv);
      const directAvatarUrl = getConversationAvatarUrl(conv);
      const aliasProfileUrl = nameToken
        ? profileAliasByName.get(`${conv.accountId}|${nameToken}`)?.profileUrl || ''
        : '';
      const aliasAvatarUrl = nameToken
        ? avatarAliasByName.get(`${conv.accountId}|${nameToken}`)?.avatarUrl || ''
        : '';
      const resolvedProfileUrl = directProfileUrl || aliasProfileUrl;
      const resolvedAvatarUrl = directAvatarUrl || aliasAvatarUrl;
      const key = resolvedProfileUrl
        ? `${conv.accountId}|profile|${resolvedProfileUrl}`
        : `${conv.accountId}|name|${nameToken || String(conv?.conversationId || '').toLowerCase()}`;

      const enrichedConversation = {
        ...conv,
        participant: {
          ...conv.participant,
          profileUrl: resolvedProfileUrl || conv?.participant?.profileUrl || '',
          avatarUrl: resolvedAvatarUrl || conv?.participant?.avatarUrl || null,
        },
      };

      const previous = latestByConversation.get(key);
      if (!previous) {
        latestByConversation.set(key, enrichedConversation);
        continue;
      }

      latestByConversation.set(key, mergeConversations(previous, enrichedConversation));
    }

    const sorted = Array.from(latestByConversation.values()).sort(
      (a, b) => (Number(b?.lastMessage?.sentAt) || 0) - (Number(a?.lastMessage?.sentAt) || 0)
    );

    const hasHighSignalRows = sorted.some(
      (conv) => Boolean(getConversationProfileUrl(conv)) || Boolean(getConversationText(conv))
    );

    if (!hasHighSignalRows) {
      return sorted;
    }

    const cleaned = sorted.filter((conv) => !isLowSignalFallbackConversation(conv));
    return cleaned.length > 0 ? cleaned : sorted;
  }

  async function buildUnifiedInboxFromActivity(limit = 100) {
    const ids = await listKnownAccountIds();
    const redis = getRedis();
    const latestByConversation = new Map();

    for (const accountId of ids) {
      let entries = [];
      try {
        entries = await redis.lrange(`activity:log:${accountId}`, 0, 500);
      } catch {
        continue;
      }

      for (const raw of entries) {
        try {
          const item = JSON.parse(raw);
          if (item?.type !== 'messageSent') continue;

          const participantProfileUrl = String(item.targetProfileUrl || '');
          const participantName = normalizeParticipantName(item.targetName, participantProfileUrl);
          const sentAt = Number(item.timestamp) || Date.now();
          const textPreview = typeof item.textPreview === 'string' && item.textPreview.length > 0
            ? item.textPreview
            : `Sent message (${Number(item.messageLength) || 0} chars)`;

          const key = `${accountId}|${participantName}|${participantProfileUrl}`;
          const previous = latestByConversation.get(key);
          if (previous && previous.lastMessage?.sentAt >= sentAt) continue;

          latestByConversation.set(key, {
            conversationId: `activity-${Buffer.from(key).toString('base64url')}`,
            accountId,
            participant: {
              name: participantName,
              profileUrl: participantProfileUrl,
            },
            lastMessage: {
              text: textPreview,
              sentAt,
              sentByMe: true,
            },
            unreadCount: 0,
            messages: [
              {
                id: `activity-msg-${sentAt}`,
                text: textPreview,
                sentAt,
                sentByMe: true,
                senderName: accountId,
              },
            ],
          });
        } catch {
          // Ignore malformed activity rows.
        }
      }
    }

    const conversations = Array.from(latestByConversation.values())
      .sort((a, b) => (b.lastMessage?.sentAt || 0) - (a.lastMessage?.sentAt || 0))
      .slice(0, limit);

    return { conversations };
  }

  async function buildUnifiedInboxFromLive(limit = 100) {
    const ids = await listKnownAccountIds();
    const proxyUrl = process.env.PROXY_URL || null;
    const perAccountLimit = Math.max(10, Math.ceil(limit / Math.max(ids.length, 1)) * 2);
    const conversations = [];
    const sessionFailures = [];

    for (const accountId of ids) {
      try {
        const inbox = await withTimeout(
          readMessages({ accountId, limit: perAccountLimit, proxyUrl }),
          30_000,
          'READ_INBOX_TIMEOUT'
        );
        clearSessionIssue(accountId);
        for (const item of inbox?.items || []) {
          conversations.push(normalizeConversationFromInboxItem(accountId, item));
        }
      } catch (err) {
        const code = err?.code;
        if (code === 'NO_SESSION' || code === 'SESSION_EXPIRED') {
          recordSessionExpired(accountId, code);
          markSessionIssue(accountId, {
            code,
            message: err?.message || 'LinkedIn session expired. Refresh cookies.',
          });
          sessionFailures.push({ accountId, code });
        } else if (code !== 'READ_INBOX_TIMEOUT') {
          logger.warn('inbox.live_read_failed', {
            accountId,
            errorCode: err?.code || 'INBOX_LIVE_READ_FAILED',
            detail: err?.message || String(err),
          });
        }
      }
    }

    return {
      conversations: dedupeAndSortConversations(conversations).slice(0, limit),
      sessionFailures,
      attemptedAccounts: ids.length,
    };
  }

  async function buildUnifiedInboxWithFallback(limit = 100) {
    const now = Date.now();
    if (unifiedInboxCache.expiresAt > now) {
      return {
        conversations: unifiedInboxCache.payload.conversations.slice(0, limit),
        degraded: true,
        source: 'live-cache',
      };
    }

    if (unifiedInboxInFlight) {
      const payload = await unifiedInboxInFlight;
      return {
        conversations: payload.conversations.slice(0, limit),
        degraded: true,
        source: 'live-inflight',
      };
    }

    unifiedInboxInFlight = (async () => {
      const activityPayload = await buildUnifiedInboxFromActivity(limit);
      let combined = activityPayload.conversations;
      let liveMeta = { sessionFailures: [], attemptedAccounts: 0 };

      if (combined.length < limit) {
        const livePayload = await buildUnifiedInboxFromLive(limit);
        liveMeta = {
          sessionFailures: livePayload.sessionFailures || [],
          attemptedAccounts: livePayload.attemptedAccounts || 0,
        };
        combined = dedupeAndSortConversations([...combined, ...livePayload.conversations]);
      } else {
        combined = dedupeAndSortConversations(combined);
      }

      if (
        combined.length === 0 &&
        liveMeta.attemptedAccounts > 0 &&
        liveMeta.sessionFailures.length === liveMeta.attemptedAccounts
      ) {
        const err = new Error('All LinkedIn sessions are missing or expired. Re-import cookies for each account.');
        err.status = 401;
        err.code = 'NO_ACTIVE_SESSION';
        throw err;
      }

      const payload = {
        conversations: combined.slice(0, limit),
        degraded: true,
        source: 'live-fallback',
      };
      unifiedInboxCache = {
        expiresAt: Date.now() + UNIFIED_INBOX_CACHE_TTL_MS,
        payload,
      };
      return payload;
    })();

    try {
      const payload = await unifiedInboxInFlight;
      return {
        conversations: payload.conversations.slice(0, limit),
        degraded: true,
        source: payload.source || 'live-fallback',
      };
    } finally {
      unifiedInboxInFlight = null;
    }
  }

  async function persistOptimisticSendNewResult({ accountId, profileUrl, text, result }) {
    if (!messageRepo) {
      return;
    }

    const participantProfileUrl = String(profileUrl || '');
    const participantName = normalizeParticipantName('', participantProfileUrl);
    const rawChatId = String(result?.chatId || '').trim();
    const fallbackKey = `${accountId}|${participantName}|${participantProfileUrl}`;
    const conversationId =
      rawChatId && rawChatId !== 'new'
        ? normalizeThreadId(accountId, rawChatId)
        : `activity-${Buffer.from(fallbackKey).toString('base64url')}`;

    const parsedCreatedAt = new Date(result?.createdAt || Date.now());
    const createdAt = Number.isNaN(parsedCreatedAt.getTime()) ? new Date() : parsedCreatedAt;

    try {
      if (!participantProfileUrl && rawChatId && rawChatId !== 'new') {
        await withTimeout(
          messageRepo.updateConversationLastMessage(conversationId, {
            text,
            sentAt: createdAt,
            sentByMe: true,
          }),
          dbWriteTimeoutMs
        );
        logger.debug('send_new.preview_updated', {
          accountId,
          conversationId,
        });
        invalidateUnifiedInboxCache(`optimistic-send:${accountId}:${conversationId}`);
        return;
      }

      await withTimeout(
        messageRepo.upsertConversation({
          id: conversationId,
          accountId,
          participantName,
          participantProfileUrl,
          participantAvatarUrl: null,
          lastMessageAt: createdAt,
          lastMessageText: text,
          lastMessageSentByMe: true,
        }),
        dbWriteTimeoutMs
      );
      logger.debug('send_new.preview_persisted', {
        accountId,
        conversationId,
      });
      invalidateUnifiedInboxCache(`optimistic-send:${accountId}:${conversationId}`);
    } catch (err) {
      if (!isDatabaseUnavailable(err)) {
        logger.warn('send_new.preview_persist_failed', {
          accountId,
          conversationId,
          errorCode: err?.code || 'SEND_PREVIEW_PERSIST_FAILED',
          error: err,
        });
      } else {
        recordDatabaseIssue(logger.child({ accountId, conversationId }), err, {
          stage: 'optimistic-send-preview',
        });
      }
    }
  }

  return {
    buildUnifiedInboxFromActivity,
    buildUnifiedInboxWithFallback,
    dedupeAndSortConversations,
    dedupeInFlightFallback,
    getUnifiedInboxCacheState,
    invalidateUnifiedInboxCache,
    liveThreadFallbacksInFlight,
    persistOptimisticSendNewResult,
  };
}

module.exports = {
  createInboxFallbackService,
};
