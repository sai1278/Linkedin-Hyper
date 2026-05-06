'use strict';

const {
  mapDbMessagesToApiItems,
  mapLiveMessagesToApiItems,
  mergeApiThreadItems,
} = require('../services/threadMessageHelpers');

function registerThreadRoutes(app, deps) {
  const {
    messageRepo,
    withTimeout,
    isDatabaseUnavailable,
    recordDatabaseIssue,
    readTimeoutMs,
    writeTimeoutMs,
    assertKnownAccountId,
    assertConversationBelongsToAccount,
    validateId,
    parseLimit,
    getRedis,
    normalizeParticipantName,
    normalizeWhitespace,
    isGenericUiLabel,
    dedupeInFlightFallback,
    runJob,
    readThread,
    logger,
    toPublicOperationError,
  } = deps;

  app.get('/messages/inbox', async (req, res) => {
    try {
      const accountId = await assertKnownAccountId(req.query.accountId);
      const limit = parseLimit(req.query.limit, 20);
      const result = await runJob('readMessages', {
        accountId,
        limit,
        proxyUrl: process.env.PROXY_URL || null,
      });
      res.json(result);
    } catch (err) {
      const status = err.status || (err.message ? 400 : 500);
      res.status(status).json({
        error: toPublicOperationError(err),
        code: err.code,
      });
    }
  });

  app.get('/messages/thread', async (req, res) => {
    try {
      const accountId = await assertKnownAccountId(req.query.accountId);
      const chatId = validateId(req.query.chatId, { field: 'chatId' });
      const normalizedChatId = await assertConversationBelongsToAccount(accountId, chatId);
      const limit = parseLimit(req.query.limit, 250, 500);
      const offset = parseInt(req.query.offset, 10) || 0;
      const refresh = String(req.query.refresh || '') === '1';
      const proxyUrl = process.env.PROXY_URL || null;

      let dbMessages = [];
      try {
        dbMessages = await withTimeout(
          messageRepo.getMessagesByConversation(chatId, limit, offset),
          readTimeoutMs
        );

        if (dbMessages.length === 0 && normalizedChatId !== chatId) {
          dbMessages = await withTimeout(
            messageRepo.getMessagesByConversation(normalizedChatId, limit, offset),
            readTimeoutMs
          );
        }
      } catch (dbErr) {
        if (!isDatabaseUnavailable(dbErr)) throw dbErr;
      }

      const dbItems = mapDbMessagesToApiItems(dbMessages);

      if (dbItems.length > 0 && !refresh) {
        logger.debug('thread.cached_db_returned', {
          accountId,
          threadId: normalizedChatId,
          dbCount: dbItems.length,
          refresh: 0,
          limit,
        });
        return res.json({
          items: dbItems,
          cursor: null,
          hasMore: dbMessages.length === limit,
        });
      }

      if (normalizedChatId.startsWith('activity-')) {
        try {
          const encodedKey = normalizedChatId.slice('activity-'.length);
          const decodedKey = Buffer.from(encodedKey, 'base64url').toString('utf8');
          const decodedParts = decodedKey.split('|');
          decodedParts.shift();
          const participantNameRaw = decodedParts.shift() || '';
          const participantProfileRaw = decodedParts.join('|');
          const participantName = normalizeParticipantName(participantNameRaw, participantProfileRaw);
          const participantProfileUrl = String(participantProfileRaw || '');

          const redis = getRedis();
          const rawActivity = await redis.lrange(`activity:log:${accountId}`, 0, 500);
          const activityMessages = [];

          for (const rawEntry of rawActivity) {
            try {
              const entry = JSON.parse(rawEntry);
              if (entry?.type !== 'messageSent') continue;

              const entryProfile = String(entry.targetProfileUrl || '');
              const entryName = normalizeParticipantName(entry.targetName, entryProfile);
              const sameParticipant =
                (participantProfileUrl && entryProfile === participantProfileUrl) ||
                entryName === participantName;

              if (!sameParticipant) continue;

              const timestamp = Number(entry.timestamp) || Date.now();
              const text = typeof entry.textPreview === 'string' && entry.textPreview.trim()
                ? entry.textPreview.trim()
                : `Sent message (${Number(entry.messageLength) || 0} chars)`;

              activityMessages.push({
                id: `activity-msg-${timestamp}-${activityMessages.length}`,
                chatId: normalizedChatId,
                senderId: '__self__',
                text,
                createdAt: new Date(timestamp).toISOString(),
                senderName: accountId,
              });
            } catch {
              // ignore malformed activity entries
            }
          }

          activityMessages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          return res.json({
            items: activityMessages.slice(-limit),
            cursor: null,
            hasMore: false,
          });
        } catch {
          return res.json({ items: [], cursor: null, hasMore: false });
        }
      }

      let liveThread = null;
      let liveItems = [];
      if (normalizedChatId.startsWith('fallback-')) {
        logger.debug('thread.live_fetch_skipped_unresolved', {
          accountId,
          threadId: normalizedChatId,
        });
      } else {
        const liveFallbackKey = `${accountId}|${normalizedChatId}|${limit}`;
        const resolvedLiveThread = await dedupeInFlightFallback(
          deps.liveThreadFallbacksInFlight,
          liveFallbackKey,
          async () => {
            try {
              return await runJob('readThread', {
                accountId,
                chatId: normalizedChatId,
                proxyUrl,
                limit,
              });
            } catch (queueErr) {
              const msg = queueErr instanceof Error ? queueErr.message : String(queueErr);
              const isQueueConnectivityError =
                msg.includes('Connection is closed') ||
                msg.includes('ECONNREFUSED') ||
                msg.includes('ENOTFOUND') ||
                msg.includes('getaddrinfo');

              if (!isQueueConnectivityError) throw queueErr;
              logger.warn('thread.queue_fallback_direct_read', {
                accountId,
                threadId: normalizedChatId,
                errorCode: 'QUEUE_UNAVAILABLE',
                detail: msg,
              });
              return readThread({ accountId, chatId: normalizedChatId, proxyUrl, limit });
            }
          }
        );

        liveThread = resolvedLiveThread;
        liveItems = mapLiveMessagesToApiItems(liveThread?.items, normalizedChatId, accountId);
      }

      const mergedThreadItems = mergeApiThreadItems(dbItems, liveItems);
      logger.info('thread.merge_summary', {
        accountId,
        threadId: normalizedChatId,
        existingDbMessageCount: dbItems.length,
        incomingMessageCount: liveItems.length,
        finalMessageCount: mergedThreadItems.length,
        refresh: refresh ? 1 : 0,
      });

      if (liveItems.length > 0) {
        try {
          const participantName =
            (liveThread?.participant?.name && !isGenericUiLabel(liveThread.participant.name))
              ? liveThread.participant.name
              : (liveItems.find((m) => m.senderId !== '__self__' && m.senderName !== 'Unknown')?.senderName || 'Unknown');
          const participantProfileUrl = liveThread?.participant?.profileUrl || null;
          const latestLive = liveItems[liveItems.length - 1];

          await withTimeout(messageRepo.upsertConversation({
            id: normalizedChatId,
            accountId,
            participantName,
            participantProfileUrl,
            participantAvatarUrl: null,
            lastMessageAt: new Date(latestLive.createdAt),
            lastMessageText: latestLive.text || '',
            lastMessageSentByMe: latestLive.senderId === '__self__',
          }), writeTimeoutMs);

          for (const item of liveItems) {
            await withTimeout(messageRepo.upsertMessage({
              conversationId: normalizedChatId,
              accountId,
              senderId: item.senderId,
              senderName: item.senderName,
              text: item.text,
              sentAt: item.createdAt,
              isSentByMe: item.senderId === '__self__',
              linkedinMessageId: item.id,
              timestampInferred: item.hasExactTimestamp !== true,
            }), writeTimeoutMs);
          }
        } catch (persistErr) {
          if (!isDatabaseUnavailable(persistErr)) {
            logger.warn('thread.live_persist_failed', {
              accountId,
              threadId: normalizedChatId,
              errorCode: persistErr?.code || 'THREAD_PERSIST_FAILED',
              error: persistErr,
            });
          } else {
            recordDatabaseIssue(logger.child({ accountId, threadId: normalizedChatId }), persistErr, {
              stage: 'thread-live-persist',
            });
          }
        }
      }

      if (mergedThreadItems.length > 0) {
        logger.debug('thread.merged_returned', {
          accountId,
          threadId: normalizedChatId,
          existingDbMessageCount: dbItems.length,
          incomingMessageCount: liveItems.length,
          finalMessageCount: mergedThreadItems.length,
          limit,
        });
        return res.json({
          items: mergedThreadItems,
          cursor: null,
          hasMore: mergedThreadItems.length >= limit,
        });
      }

      if (liveItems.length === 0) {
        try {
          let conversation = await withTimeout(
            messageRepo.getConversationById(chatId),
            readTimeoutMs
          );

          if (!conversation && normalizedChatId !== chatId) {
            conversation = await withTimeout(
              messageRepo.getConversationById(normalizedChatId),
              readTimeoutMs
            );
          }

          const previewText = normalizeWhitespace(conversation?.lastMessageText || '');
          if (previewText) {
            const previewCreatedAt = new Date(conversation?.lastMessageAt || Date.now()).toISOString();
            const previewSentByMe = Boolean(conversation?.lastMessageSentByMe);
            return res.json({
              items: [{
                id: `preview-${normalizedChatId}`,
                chatId: normalizedChatId,
                senderId: previewSentByMe ? '__self__' : 'other',
                text: previewText,
                createdAt: previewCreatedAt,
                sentAt: previewCreatedAt,
                isSentByMe: previewSentByMe,
                senderName: previewSentByMe
                  ? accountId
                  : normalizeParticipantName(
                      conversation?.participantName,
                      conversation?.participantProfileUrl || ''
                    ),
              }],
              cursor: null,
              hasMore: false,
            });
          }
        } catch (previewErr) {
          if (!isDatabaseUnavailable(previewErr)) {
            logger.warn('thread.preview_fallback_failed', {
              accountId,
              threadId: normalizedChatId,
              errorCode: previewErr?.code || 'THREAD_PREVIEW_FALLBACK_FAILED',
              error: previewErr,
            });
          } else {
            recordDatabaseIssue(logger.child({ accountId, threadId: normalizedChatId }), previewErr, {
              stage: 'thread-preview-fallback',
            });
          }
        }
      }

      return res.json({
        items: liveItems,
        cursor: liveThread?.cursor || null,
        hasMore: Boolean(liveThread?.hasMore),
      });
    } catch (err) {
      const status = err.status || (err.message ? 400 : 500);
      res.status(status).json({
        error: toPublicOperationError(err),
        code: err.code,
      });
    }
  });
}

module.exports = {
  registerThreadRoutes,
};
