'use strict';

function registerInboxRoutes(app, deps) {
  const {
    messageRepo,
    parseLimit,
    withTimeout,
    isDatabaseUnavailable,
    buildUnifiedInboxFromActivity,
    dedupeAndSortConversations,
    buildUnifiedInboxWithFallback,
    getUnifiedInboxCacheState,
    recordDatabaseIssue,
    applyRetryAfterHeader,
    toPublicOperationError,
    logger,
    readTimeoutMs,
  } = deps;

  app.get('/inbox/unified', async (req, res) => {
    const log = (req.log || logger).child({ route: '/inbox/unified' });

    try {
      const limit = parseLimit(req.query.limit, 100, 200);
      const offset = parseInt(req.query.offset, 10) || 0;

      const conversations = await withTimeout(
        messageRepo.getAllConversationsWithMessages(limit, offset),
        readTimeoutMs
      );

      const payload = {
        conversations: conversations.map((conv) => ({
          conversationId: conv.id,
          accountId: conv.accountId,
          participant: {
            name: conv.participantName,
            profileUrl: conv.participantProfileUrl || '',
            avatarUrl: conv.participantAvatarUrl || null,
          },
          lastMessage: {
            text: conv.lastMessageText,
            sentAt: new Date(conv.lastMessageAt).getTime(),
            sentByMe: conv.lastMessageSentByMe,
          },
          unreadCount: 0,
          messages: (conv.messages || []).map((message) => ({
            id: message.linkedinMessageId || message.id,
            text: message.text,
            sentAt: new Date(message.sentAt).getTime(),
            sentByMe: Boolean(message.isSentByMe),
            senderName: message.senderName || (message.isSentByMe ? conv.accountId : 'Unknown'),
          })),
        })),
      };

      const activityPayload = await buildUnifiedInboxFromActivity(limit);
      const mergedConversations = dedupeAndSortConversations([
        ...payload.conversations,
        ...(activityPayload?.conversations || []),
      ]).slice(0, limit);

      if (mergedConversations.length === 0) {
        const livePayload = await buildUnifiedInboxWithFallback(limit);
        return res.json(livePayload);
      }

      const totalReturnedMessages = mergedConversations.reduce(
        (sum, conversation) => sum + (Array.isArray(conversation.messages) ? conversation.messages.length : 0),
        0
      );

      log.info('inbox.unified_served', {
        conversationCount: mergedConversations.length,
        messageCount: totalReturnedMessages,
        limit,
        offset,
      });

      return res.json({ conversations: mergedConversations });
    } catch (err) {
      if (isDatabaseUnavailable(err)) {
        recordDatabaseIssue(log, err, { route: '/inbox/unified' });

        const staleCache = getUnifiedInboxCacheState();
        if (staleCache?.payload?.conversations?.length) {
          log.warn('inbox.unified_served_stale_cache', {
            conversationCount: staleCache.payload.conversations.length,
          });
          return res.json({
            conversations: staleCache.payload.conversations.slice(
              0,
              parseLimit(req.query.limit, 100, 200)
            ),
            stale: true,
          });
        }

        try {
          const livePayload = await buildUnifiedInboxWithFallback(parseLimit(req.query.limit, 100, 200));
          return res.json(livePayload);
        } catch (fallbackErr) {
          if (fallbackErr?.status) {
            const retryAfterSec = applyRetryAfterHeader(res, fallbackErr);
            return res.status(fallbackErr.status).json({
              error: toPublicOperationError(fallbackErr),
              code: fallbackErr.code,
              retryAfterSec,
            });
          }

          log.error('inbox.unified_fallback_failed', {
            errorCode: fallbackErr?.code || 'INBOX_FALLBACK_FAILED',
            error: fallbackErr,
          });
          return res.status(500).json({
            error: process.env.NODE_ENV === 'production' ? 'Internal error' : fallbackErr.message,
          });
        }
      }

      if (err?.status) {
        return res.status(err.status).json({
          error: toPublicOperationError(err),
          code: err.code,
        });
      }

      log.error('inbox.unified_failed', {
        errorCode: err?.code || 'INBOX_UNIFIED_FAILED',
        error: err,
      });
      return res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
    }
  });
}

module.exports = {
  registerInboxRoutes,
};
