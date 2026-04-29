// FILE: worker/src/services/messageSyncService.js
// Message synchronization service - fetches from LinkedIn and stores in database

'use strict';

const { readMessages } = require('../actions/readMessages');
const { readThread } = require('../actions/readThread');
const { verifySession } = require('../actions/login');
const { sessionMeta } = require('../session');
const accountRepo = require('../db/repositories/AccountRepository');
const messageRepo = require('../db/repositories/MessageRepository');
const { emitInboxUpdate, emitNewMessage } = require('../utils/websocket');
const { getRedis } = require('../redisClient');
const { logger } = require('../utils/logger');
const { recordSessionExpired, recordSyncResult } = require('../utils/metrics');
const { DB_READ_TIMEOUT_MS, DB_WRITE_TIMEOUT_MS, isDatabaseUnavailable, recordDatabaseIssue, withTimeout } = require('../utils/database');
const {
  clearSessionIssue,
  getHealthStateSnapshot,
  markBulkSyncCompleted,
  markBulkSyncFailed,
  markBulkSyncStarted,
  markSessionIssue,
  markSyncCompleted,
  markSyncFailed,
  markSyncStarted,
} = require('../healthState');

const SCHEDULER_SESSION_PROTECTION_MS = Math.max(
  0,
  parseInt(process.env.SCHEDULER_SESSION_PROTECTION_MS || String(2 * 60 * 60_000), 10) || (2 * 60 * 60_000)
);

function getBulkSyncDisabledAccountIds() {
  return new Set(
    (process.env.MESSAGE_SYNC_DISABLED_ACCOUNT_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

function isSyntheticConversationId(conversationId) {
  return String(conversationId || '').startsWith('fallback-');
}

function isSessionRecoveryCandidate(err) {
  const code = String(err?.code || '');
  const message = String(err?.message || err || '');
  return (
    code === 'NO_SESSION' ||
    code === 'SESSION_EXPIRED' ||
    code === 'AUTHENTICATED_STATE_NOT_REACHED' ||
    code === 'COOKIES_MISSING' ||
    message.includes('Session expired for account') ||
    message.includes('Authenticated LinkedIn member state was not reached')
  );
}

/**
 * Sync messages for a single account
 * @param {string} accountId - Account ID to sync
 * @param {string|null} proxyUrl - Proxy URL if configured
 * @returns {Promise<Object>} Sync stats
 */
async function syncAccount(accountId, proxyUrl = null, meta = {}) {
  const source = meta?.source || 'scheduler';
  const log = logger.child({ flow: 'message-sync', accountId, source });
  log.info('sync.account_started');
  if (source === 'scheduler') {
    const healthState = getHealthStateSnapshot();
    const accountState = healthState.accounts?.[accountId] || {};
    if (accountState.sessionIssue) {
      log.info('sync.account_skipped', {
        reason: 'session_issue_active',
        errorCode: accountState.sessionIssue.code || 'unknown',
      });
      return {
        accountId,
        conversationsProcessed: 0,
        newMessages: 0,
        updatedConversations: 0,
        errors: [],
        skipped: true,
        skipReason: 'session_issue_active',
        startedAt: new Date(),
        completedAt: new Date(),
      };
    }

    const metaSnapshot = await sessionMeta(accountId).catch(() => null);
    const ageMs = Number(metaSnapshot?.ageSeconds) > 0 ? Number(metaSnapshot.ageSeconds) * 1000 : 0;
    if (
      SCHEDULER_SESSION_PROTECTION_MS > 0 &&
      ageMs > 0 &&
      ageMs < SCHEDULER_SESSION_PROTECTION_MS
    ) {
      log.info('sync.account_skipped', {
        reason: 'recent_session_refresh',
        ageSeconds: Math.round(ageMs / 1000),
      });
      return {
        accountId,
        conversationsProcessed: 0,
        newMessages: 0,
        updatedConversations: 0,
        errors: [],
        skipped: true,
        skipReason: 'recent_session_refresh',
        startedAt: new Date(),
        completedAt: new Date(),
      };
    }
  }
  markSyncStarted(accountId, source);
  
  const stats = {
    accountId,
    conversationsProcessed: 0,
    newMessages: 0,
    updatedConversations: 0,
    errors: [],
    startedAt: new Date(),
  };

  try {
    // Ensure account exists in database
    try {
      await withTimeout(accountRepo.upsertAccount(accountId, accountId), DB_WRITE_TIMEOUT_MS);
    } catch (dbErr) {
      if (isDatabaseUnavailable(dbErr)) {
        recordDatabaseIssue(log, dbErr, { stage: 'upsertAccount' });
        stats.errors.push({
          fatal: true,
          code: dbErr.code || 'DB_UNAVAILABLE',
          error: dbErr.message || String(dbErr),
        });
        stats.completedAt = new Date();
        stats.durationMs = stats.completedAt - stats.startedAt;
        return stats;
      }
      throw dbErr;
    }

    // Fetch conversations from LinkedIn
    log.info('sync.read_messages_started');
    const allowSessionCookieRefresh = source !== 'scheduler';
    let inboxData;
    try {
      inboxData = await readMessages({
        accountId,
        proxyUrl,
        limit: 50,
        refreshSessionCookies: allowSessionCookieRefresh,
      });
    } catch (inboxErr) {
      if (!isSessionRecoveryCandidate(inboxErr)) {
        throw inboxErr;
      }

      log.warn('sync.read_messages_recovering', {
        errorCode: inboxErr?.code || 'READ_MESSAGES_RECOVERY',
        detail: inboxErr.message,
      });
      await verifySession({
        accountId,
        proxyUrl,
        persistCookies: allowSessionCookieRefresh,
        allowCachedSuccess: false,
      });
      inboxData = await readMessages({
        accountId,
        proxyUrl,
        limit: 50,
        refreshSessionCookies: allowSessionCookieRefresh,
      });
    }
    clearSessionIssue(accountId);
    
    if (!inboxData || !inboxData.items || inboxData.items.length === 0) {
      log.info('sync.no_conversations_found');
      recordSyncResult(accountId, true);
      markSyncCompleted(accountId, stats, source);
      return stats;
    }

    log.info('sync.conversations_fetched', { conversationCount: inboxData.items.length });

    // Process each conversation
    for (const conv of inboxData.items) {
      try {
        stats.conversationsProcessed++;

        // Extract conversation data
        const conversationId = conv.id;
        let participantName = conv.participants[0]?.name || 'Unknown';
        let participantProfileUrl = conv.participants[0]?.profileUrl || null;
        const participantAvatarUrl = conv.participants[0]?.avatarUrl || null;
        const initialLastMessageAt = new Date(conv.lastMessage?.createdAt || conv.createdAt || Date.now());
        const initialLastMessageText = conv.lastMessage?.text || '';
        const initialLastMessageSentByMe = conv.lastMessage?.senderId === '__self__';

        // Upsert conversation
        await withTimeout(messageRepo.upsertConversation({
          id: conversationId,
          accountId,
          participantName,
          participantProfileUrl,
          participantAvatarUrl,
          lastMessageAt: initialLastMessageAt,
          lastMessageText: initialLastMessageText,
          lastMessageSentByMe: initialLastMessageSentByMe,
        }), DB_WRITE_TIMEOUT_MS);
        stats.updatedConversations++;

        let threadData = { items: [], participant: null, cursor: null, hasMore: false };
        if (isSyntheticConversationId(conversationId)) {
          log.debug('sync.thread_skipped_preview_only', { threadId: conversationId });
        } else {
          // Fetch thread messages only when we have a real LinkedIn thread id.
          log.debug('sync.thread_fetch_started', { threadId: conversationId });
          try {
            threadData = await readThread({
              accountId,
              chatId: conversationId,
              proxyUrl,
              limit: 250,
              refreshSessionCookies: allowSessionCookieRefresh,
            });
          } catch (threadErr) {
            if (!isSessionRecoveryCandidate(threadErr)) {
              throw threadErr;
            }

            log.warn('sync.thread_recovering', {
              threadId: conversationId,
              errorCode: threadErr?.code || 'READ_THREAD_RECOVERY',
              detail: threadErr.message,
            });
            await verifySession({
              accountId,
              proxyUrl,
              persistCookies: allowSessionCookieRefresh,
              allowCachedSuccess: false,
            });
            threadData = await readThread({
              accountId,
              chatId: conversationId,
              proxyUrl,
              limit: 250,
              refreshSessionCookies: allowSessionCookieRefresh,
            });
          }
        }

        // Enrich missing participant metadata from thread page.
        const threadParticipantName = threadData?.participant?.name;
        const threadParticipantProfileUrl = threadData?.participant?.profileUrl || null;
        if (threadParticipantName && threadParticipantName !== 'Unknown' && participantName === 'Unknown') {
          participantName = threadParticipantName;
        }
        if (threadParticipantProfileUrl && !participantProfileUrl) {
          participantProfileUrl = threadParticipantProfileUrl;
        }
        if ((!participantName || participantName === 'Unknown') && Array.isArray(threadData?.items)) {
          const firstOther = threadData.items.find(
            (msg) => msg?.senderId !== '__self__' && msg?.senderName && msg.senderName !== 'Unknown'
          );
          if (firstOther?.senderName) {
            participantName = firstOther.senderName;
          }
        }

        // Persist enriched metadata if we improved anything.
        if (
          participantName !== (conv.participants[0]?.name || 'Unknown') ||
          participantProfileUrl !== (conv.participants[0]?.profileUrl || null)
        ) {
          await withTimeout(messageRepo.upsertConversation({
            id: conversationId,
            accountId,
            participantName,
            participantProfileUrl,
            participantAvatarUrl,
            lastMessageAt: initialLastMessageAt,
            lastMessageText: initialLastMessageText,
            lastMessageSentByMe: initialLastMessageSentByMe,
          }), DB_WRITE_TIMEOUT_MS);
        }

        if (threadData && threadData.items && threadData.items.length > 0) {
          log.info('sync.thread_merge_input', {
            threadId: conversationId,
            fetchedMessageCount: threadData.items.length,
          });
          // Get existing message count before sync
          const existingCount = await withTimeout(
            messageRepo.countMessagesByConversation(conversationId),
            DB_READ_TIMEOUT_MS
          );

          // Upsert each message
          let newMessagesInThread = 0;
          for (const msg of threadData.items) {
            try {
              const result = await withTimeout(messageRepo.upsertMessage({
                conversationId,
                accountId,
                senderId: msg.senderId || '__unknown__',
                senderName: msg.senderName || 'Unknown',
                text: msg.text || '',
                sentAt: new Date(msg.createdAt || Date.now()),
                isSentByMe: msg.senderId === '__self__',
                linkedinMessageId: msg.id || null,
                timestampInferred: msg.hasExactTimestamp !== true,
              }), DB_WRITE_TIMEOUT_MS);

              // If message was newly created (not a duplicate)
              if (result) {
                newMessagesInThread++;
              }
            } catch (msgError) {
              log.error('sync.thread_message_upsert_failed', {
                threadId: conversationId,
                errorCode: msgError?.code || 'MESSAGE_UPSERT_FAILED',
                error: msgError,
              });
              stats.errors.push({
                conversationId,
                messageError: msgError.message,
              });
            }
          }

          // Update conversation preview from latest thread message when available.
          const latestThreadMessage = threadData.items[threadData.items.length - 1];
          if (latestThreadMessage) {
            await withTimeout(messageRepo.updateConversationLastMessage(conversationId, {
              sentAt: latestThreadMessage.createdAt || Date.now(),
              text: latestThreadMessage.text || initialLastMessageText,
              sentByMe: latestThreadMessage.senderId === '__self__',
            }), DB_WRITE_TIMEOUT_MS);
          }

          stats.newMessages += newMessagesInThread;
          
          // Get new count after sync
          const newCount = await withTimeout(
            messageRepo.countMessagesByConversation(conversationId),
            DB_READ_TIMEOUT_MS
          );
          const actualNew = newCount - existingCount;
          const duplicatesSkipped = Math.max(0, threadData.items.length - Math.max(0, actualNew));

          log.info('sync.thread_persisted', {
            threadId: conversationId,
            fetchedMessageCount: threadData.items.length,
            existingDbMessageCount: existingCount,
            insertedCount: Math.max(0, actualNew),
            duplicatesSkipped,
            finalDbMessageCount: newCount,
          });

          if (actualNew > 0) {
            log.info('sync.new_messages_added', {
              threadId: conversationId,
              newMessages: actualNew,
            });
            
            // Emit WebSocket event for new messages
            emitNewMessage(accountId, {
              conversationId,
              participantName,
              newMessagesCount: actualNew,
            });
            log.info('sync.websocket_event_emitted', {
              threadId: conversationId,
              newMessages: actualNew,
            });
          }
        } else if (!isSyntheticConversationId(conversationId)) {
          log.warn('sync.thread_empty', {
            threadId: conversationId,
            previewTextPresent: Boolean(initialLastMessageText),
            participantName,
          });
        }

        // Small delay to avoid rate limits
        await delay(500, 1000);

      } catch (convError) {
        if (isDatabaseUnavailable(convError)) {
          stats.errors.push({
            fatal: true,
            code: convError.code || 'DB_UNAVAILABLE',
            error: convError.message || String(convError),
          });
          markSyncCompleted(accountId, stats, source);
          stats.completedAt = new Date();
          stats.durationMs = stats.completedAt - stats.startedAt;
          recordDatabaseIssue(log, convError, {
            stage: 'conversation-loop',
            threadId: conversationId,
          });
          return stats;
        }
        log.error('sync.conversation_failed', {
          threadId: conv.id,
          errorCode: convError?.code || 'CONVERSATION_SYNC_FAILED',
          error: convError,
        });
        stats.errors.push({
          conversationId: conv.id,
          error: convError.message,
        });
      }
    }

    // Update account's last synced timestamp
    await withTimeout(accountRepo.updateLastSyncedAt(accountId), DB_WRITE_TIMEOUT_MS);

    // Emit WebSocket event for completed sync
    emitInboxUpdate(accountId, {
      conversationsCount: stats.conversationsProcessed,
      newMessagesCount: stats.newMessages,
      syncedAt: new Date().toISOString(),
    });

    stats.completedAt = new Date();
    stats.durationMs = stats.completedAt - stats.startedAt;
    
    log.info('sync.account_completed', {
      conversationsProcessed: stats.conversationsProcessed,
      newMessages: stats.newMessages,
      durationMs: stats.durationMs,
      errorCount: stats.errors.length,
    });

    // Log to Redis activity log
    const redis = getRedis();
    await redis.lpush(
      `activity:log:${accountId}`,
      JSON.stringify({
        type: 'sync',
        accountId,
        timestamp: Date.now(),
        stats: {
          conversations: stats.conversationsProcessed,
          newMessages: stats.newMessages,
          errors: stats.errors.length,
        },
      })
    );
    await redis.ltrim(`activity:log:${accountId}`, 0, 999); // Keep last 1000 entries

    recordSyncResult(accountId, true);
    markSyncCompleted(accountId, stats, source);
    return stats;

  } catch (error) {
    log.error('sync.account_failed', {
      errorCode: error?.code || 'SYNC_ACCOUNT_FAILED',
      error,
    });
    if (['NO_SESSION', 'SESSION_EXPIRED', 'AUTHENTICATED_STATE_NOT_REACHED', 'COOKIES_MISSING'].includes(error?.code)) {
      recordSessionExpired(accountId, error.code);
      markSessionIssue(accountId, {
        code: error.code,
        message: error.message || 'Session expired. Refresh cookies.',
      });
    }
    stats.errors.push({
      fatal: true,
      error: error.message,
      stack: error.stack,
    });
    recordSyncResult(accountId, false);
    markSyncFailed(accountId, error, source);
    stats.completedAt = new Date();
    return stats;
  }
}

/**
 * Sync messages for all configured accounts (staggered)
 * @param {string|null} proxyUrl - Proxy URL if configured
 * @returns {Promise<Object>} Aggregated sync stats
 */
async function syncAllAccounts(proxyUrl = null, meta = {}) {
  const source = meta?.source || 'scheduler';
  const log = logger.child({ flow: 'message-sync-bulk', source });
  log.info('sync.bulk_started');

  try {
    const configuredAccountIds = (process.env.ACCOUNT_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (configuredAccountIds.length === 0) {
      log.warn('sync.bulk_no_accounts_configured');
      return {
        totalAccounts: 0,
        results: [],
      };
    }

    const disabledAccountIds = getBulkSyncDisabledAccountIds();
    const skippedAccountIds = configuredAccountIds.filter((accountId) => disabledAccountIds.has(accountId));
    const accountIds = configuredAccountIds.filter((accountId) => !disabledAccountIds.has(accountId));

    if (skippedAccountIds.length > 0) {
      log.info('sync.bulk_disabled_accounts', { skippedAccountIds });
    }

    if (accountIds.length === 0) {
      log.warn('sync.bulk_all_accounts_disabled');
      return {
        totalAccounts: 0,
        results: [],
        skippedAccounts: skippedAccountIds,
      };
    }

    markBulkSyncStarted(accountIds, source);
    const results = [];
    
    // Sync accounts sequentially with staggered timing to respect rate limits
    for (const accountId of accountIds) {
      try {
        const accountStats = await syncAccount(accountId, proxyUrl, meta);
        results.push(accountStats);
        
        // Stagger syncs: wait 2-3 minutes between accounts
        if (accountIds.indexOf(accountId) < accountIds.length - 1) {
          const staggerDelay = 120000 + Math.random() * 60000; // 2-3 minutes
          log.debug('sync.bulk_stagger_wait', { delaySeconds: Math.round(staggerDelay / 1000) });
          await delay(staggerDelay);
        }
      } catch (error) {
        log.error('sync.bulk_account_failed', {
          accountId,
          errorCode: error?.code || 'SYNC_BULK_ACCOUNT_FAILED',
          error,
        });
        markSyncFailed(accountId, error, source);
        results.push({
          accountId,
          error: error.message,
          errors: [{ fatal: true, error: error.message }],
        });
      }
    }

    const aggregated = {
      totalAccounts: accountIds.length,
      successfulAccounts: results.filter(r => !r.errors || r.errors.length === 0).length,
      totalConversations: results.reduce((sum, r) => sum + (r.conversationsProcessed || 0), 0),
      totalNewMessages: results.reduce((sum, r) => sum + (r.newMessages || 0), 0),
      totalErrors: results.reduce((sum, r) => sum + (r.errors?.length || 0), 0),
      skippedAccounts: skippedAccountIds,
      results,
      syncedAt: new Date().toISOString(),
    };

    log.info('sync.bulk_completed', aggregated);
    markBulkSyncCompleted(aggregated, source);
    
    return aggregated;
  } catch (error) {
    markBulkSyncFailed(error, source);
    throw error;
  }
}

/**
 * Delay helper function
 * @param {number} minMs - Minimum delay in milliseconds
 * @param {number} maxMs - Maximum delay in milliseconds (optional)
 * @returns {Promise<void>}
 */
function delay(minMs, maxMs) {
  const delayMs = maxMs ? minMs + Math.random() * (maxMs - minMs) : minMs;
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

module.exports = {
  syncAccount,
  syncAllAccounts,
};
