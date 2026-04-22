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

function isDatabaseUnavailable(err) {
  if (!err) return false;
  const code = err.code || err?.meta?.code;
  const message = err instanceof Error ? err.message : String(err);
  return (
    code === 'DB_TIMEOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'P1001' ||
    code === 'P2021' ||
    code === 'P2022' ||
    message.includes('ECONNREFUSED') ||
    message.includes("Can't reach database server") ||
    message.includes('does not exist in the current database') ||
    message.includes('timeout expired') ||
    message.includes('Connection terminated unexpectedly')
  );
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

async function withTimeout(promise, timeoutMs, code = 'DB_TIMEOUT') {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`Operation timed out after ${timeoutMs}ms`);
      err.code = code;
      reject(err);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Sync messages for a single account
 * @param {string} accountId - Account ID to sync
 * @param {string|null} proxyUrl - Proxy URL if configured
 * @returns {Promise<Object>} Sync stats
 */
async function syncAccount(accountId, proxyUrl = null, meta = {}) {
  console.log(`[MessageSync] Starting sync for account: ${accountId}`);
  const source = meta?.source || 'scheduler';
  if (source === 'scheduler') {
    const healthState = getHealthStateSnapshot();
    const accountState = healthState.accounts?.[accountId] || {};
    if (accountState.sessionIssue) {
      console.log(
        `[MessageSync] Skipping scheduled sync for ${accountId}; session issue is active (${accountState.sessionIssue.code || 'unknown'}).`
      );
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
      console.log(
        `[MessageSync] Skipping scheduled sync for ${accountId}; session refreshed ${Math.round(ageMs / 1000)}s ago.`
      );
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
      await withTimeout(accountRepo.upsertAccount(accountId, accountId), 4000);
    } catch (dbErr) {
      if (isDatabaseUnavailable(dbErr)) {
        const message = `[MessageSync] Database unavailable for ${accountId}; skipping persistence sync.`;
        console.warn(message);
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
    console.log(`[MessageSync] Fetching conversations for ${accountId}...`);
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

      console.warn(`[MessageSync] Inbox read needs recovery for ${accountId}: ${inboxErr.message}`);
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
      console.log(`[MessageSync] No conversations found for ${accountId}`);
      markSyncCompleted(accountId, stats, source);
      return stats;
    }

    console.log(`[MessageSync] Found ${inboxData.items.length} conversations for ${accountId}`);

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
        }), 4000);
        stats.updatedConversations++;

        let threadData = { items: [], participant: null, cursor: null, hasMore: false };
        if (isSyntheticConversationId(conversationId)) {
          console.log(
            `[MessageSync] Skipping thread fetch for unresolved conversation ${conversationId}; preview sync only.`
          );
        } else {
          // Fetch thread messages only when we have a real LinkedIn thread id.
          console.log(`[MessageSync] Fetching messages for conversation ${conversationId}...`);
          try {
            threadData = await readThread({
              accountId,
              chatId: conversationId,
              proxyUrl,
              limit: 100,
              refreshSessionCookies: allowSessionCookieRefresh,
            });
          } catch (threadErr) {
            if (!isSessionRecoveryCandidate(threadErr)) {
              throw threadErr;
            }

            console.warn(`[MessageSync] Thread read needs recovery for ${accountId}/${conversationId}: ${threadErr.message}`);
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
              limit: 100,
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
          }), 4000);
        }

        if (threadData && threadData.items && threadData.items.length > 0) {
          // Get existing message count before sync
          const existingCount = await withTimeout(
            messageRepo.countMessagesByConversation(conversationId),
            4000
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
              }), 4000);

              // If message was newly created (not a duplicate)
              if (result) {
                newMessagesInThread++;
              }
            } catch (msgError) {
              console.error(`[MessageSync] Error upserting message in ${conversationId}:`, msgError.message);
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
            }), 4000);
          }

          stats.newMessages += newMessagesInThread;
          
          // Get new count after sync
          const newCount = await withTimeout(
            messageRepo.countMessagesByConversation(conversationId),
            4000
          );
          const actualNew = newCount - existingCount;

          if (actualNew > 0) {
            console.log(`[MessageSync] Added ${actualNew} new messages to conversation ${conversationId}`);
            
            // Emit WebSocket event for new messages
            emitNewMessage(accountId, {
              conversationId,
              participantName,
              newMessagesCount: actualNew,
            });
          }
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
          console.warn(`[MessageSync] Stopping sync for ${accountId} due to database unavailability.`);
          return stats;
        }
        console.error(`[MessageSync] Error processing conversation ${conv.id}:`, convError.message);
        stats.errors.push({
          conversationId: conv.id,
          error: convError.message,
        });
      }
    }

    // Update account's last synced timestamp
    await withTimeout(accountRepo.updateLastSyncedAt(accountId), 4000);

    // Emit WebSocket event for completed sync
    emitInboxUpdate(accountId, {
      conversationsCount: stats.conversationsProcessed,
      newMessagesCount: stats.newMessages,
      syncedAt: new Date().toISOString(),
    });

    stats.completedAt = new Date();
    stats.durationMs = stats.completedAt - stats.startedAt;
    
    console.log(`[MessageSync] Completed sync for ${accountId}:`, {
      conversations: stats.conversationsProcessed,
      newMessages: stats.newMessages,
      duration: `${stats.durationMs}ms`,
      errors: stats.errors.length,
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

    markSyncCompleted(accountId, stats, source);
    return stats;

  } catch (error) {
    console.error(`[MessageSync] Fatal error syncing account ${accountId}:`, error);
    if (['NO_SESSION', 'SESSION_EXPIRED', 'AUTHENTICATED_STATE_NOT_REACHED', 'COOKIES_MISSING'].includes(error?.code)) {
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
  console.log('[MessageSync] Starting sync for all accounts...');
  const source = meta?.source || 'scheduler';

  try {
    const configuredAccountIds = (process.env.ACCOUNT_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (configuredAccountIds.length === 0) {
      console.warn('[MessageSync] No accounts configured in ACCOUNT_IDS');
      return {
        totalAccounts: 0,
        results: [],
      };
    }

    const disabledAccountIds = getBulkSyncDisabledAccountIds();
    const skippedAccountIds = configuredAccountIds.filter((accountId) => disabledAccountIds.has(accountId));
    const accountIds = configuredAccountIds.filter((accountId) => !disabledAccountIds.has(accountId));

    if (skippedAccountIds.length > 0) {
      console.log(
        `[MessageSync] Bulk sync disabled for account(s): ${skippedAccountIds.join(', ')}`
      );
    }

    if (accountIds.length === 0) {
      console.warn('[MessageSync] All configured accounts are currently excluded from bulk sync');
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
          console.log(`[MessageSync] Waiting ${Math.round(staggerDelay/1000)}s before next account...`);
          await delay(staggerDelay);
        }
      } catch (error) {
        console.error(`[MessageSync] Failed to sync account ${accountId}:`, error);
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

    console.log('[MessageSync] All accounts sync completed:', aggregated);
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
