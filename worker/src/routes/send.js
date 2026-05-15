'use strict';

function registerSendRoutes(app, deps) {
  const {
    logger,
    assertKnownAccountId,
    validateProfileUrl,
    assertConversationBelongsToAccount,
    sanitizeText,
    runJob,
    cleanupContext,
    normalizeProfileUrlForCompare,
    normalizeThreadId,
    persistOptimisticSendNewResult,
    recordMessageSent,
    applyRetryAfterHeader,
    recordSendFailure,
    recordSessionExpired,
    toPublicOperationError,
  } = deps;

  app.post('/messages/send', async (_req, res) => {
    res.status(410).json({
      error: 'This route is deprecated. Use /messages/send-new with profileUrl or chatId.',
      code: 'SEND_ROUTE_DEPRECATED',
    });
  });

  app.post('/messages/send-new', async (req, res) => {
    const log = (req.log || logger).child({ route: '/messages/send-new' });
    try {
      const accountId = await assertKnownAccountId(req.body?.accountId);
      const rawProfileUrl = String(req.body?.profileUrl || '').trim();
      const rawChatId = String(req.body?.chatId || '').trim();
      const profileUrl = rawProfileUrl ? validateProfileUrl(rawProfileUrl) : '';
      const normalizedChatId = rawChatId
        ? await assertConversationBelongsToAccount(accountId, rawChatId)
        : '';
      const text = sanitizeText(req.body?.text, { maxLength: 3000 });
      if (!text) return res.status(400).json({ error: 'text is required' });
      if (!profileUrl && !normalizedChatId) {
        return res.status(400).json({
          error: 'Either profileUrl or chatId is required',
          code: 'SEND_TARGET_REQUIRED',
        });
      }
      res.setTimeout(230_000, () => {
        if (!res.headersSent) res.status(504).json({ error: 'Request timed out' });
      });

      let result;
      if (normalizedChatId && !profileUrl) {
        if (normalizedChatId.startsWith('activity-')) {
          return res.status(400).json({
            error: 'This conversation is activity-only and cannot be replied yet. Run sync and retry.',
            code: 'THREAD_NOT_REPLYABLE',
          });
        }
        if (normalizedChatId.startsWith('fallback-')) {
          return res.status(400).json({
            error: 'This conversation does not have a stable LinkedIn thread yet. Open the real thread or run sync and retry.',
            code: 'THREAD_NOT_REPLYABLE',
          });
        }
        result = await runJob('sendMessageNew', {
          accountId,
          chatId: normalizedChatId,
          text,
          proxyUrl: process.env.PROXY_URL || null,
        });
      } else {
        try {
          result = await runJob('sendMessageNew', {
            accountId, profileUrl, text, proxyUrl: process.env.PROXY_URL || null,
          }, 220_000);
        } catch (sendNewErr) {
          const sendNewReason = String(sendNewErr?.message || sendNewErr || '').toLowerCase();
          const skipThreadFallback =
            sendNewErr?.code === 'SEND_NOT_CONFIRMED' ||
            sendNewErr?.status === 504 ||
            sendNewReason.includes('timed out after') ||
            sendNewReason.includes('session expired for account') ||
            sendNewReason.includes('authenticated linkedin member state was not reached') ||
            sendNewReason.includes('checkpoint/challenge is still pending') ||
            sendNewReason.includes('login is not fully completed') ||
            sendNewReason.includes('cookies missing');

          if (skipThreadFallback) {
            throw sendNewErr;
          }

          log.warn('send_new.primary_failed_thread_fallback', {
            accountId,
            errorCode: sendNewErr?.code || 'SEND_NEW_PRIMARY_FAILED',
            detail: String(sendNewErr?.message || sendNewErr || ''),
          });

          await cleanupContext(accountId).catch(() => {});

          let inboxResult;
          try {
            inboxResult = await runJob('readMessages', {
              accountId,
              limit: 100,
              proxyUrl: process.env.PROXY_URL || null,
            }, 90_000);
          } catch (fallbackErr) {
            log.warn('send_new.thread_fallback_inbox_failed', {
              accountId,
              errorCode: fallbackErr?.code || 'THREAD_FALLBACK_INBOX_FAILED',
              detail: String(fallbackErr?.message || fallbackErr || ''),
            });
            throw sendNewErr;
          }

          const normalizedTarget = normalizeProfileUrlForCompare(profileUrl);
          const matchedConversation = (inboxResult?.items || []).find((item) => {
            const participantUrl = item?.participants?.[0]?.profileUrl || '';
            return (
              participantUrl &&
              normalizeProfileUrlForCompare(participantUrl) === normalizedTarget
            );
          });

          if (!matchedConversation?.id) throw sendNewErr;

          const matchedChatId = normalizeThreadId(accountId, matchedConversation.id);
          if (!matchedChatId || matchedChatId.startsWith('activity-') || matchedChatId.startsWith('fallback-')) {
            throw sendNewErr;
          }

          result = await runJob('sendMessageNew', {
            accountId,
            chatId: matchedChatId,
            text,
            proxyUrl: process.env.PROXY_URL || null,
          });
        }
      }

      await persistOptimisticSendNewResult({
        accountId,
        profileUrl: profileUrl || '',
        text,
        result,
      });
      recordMessageSent(accountId);
      log.info('send_new.completed', {
        accountId,
        chatId: result?.chatId || normalizedChatId || null,
      });

      if (!res.headersSent) {
        res.json(result);
      }
    } catch (err) {
      if (res.headersSent) return;
      const status = err.status || (err.message ? 400 : 500);
      const retryAfterSec = applyRetryAfterHeader(res, err);
      recordSendFailure(String(req.body?.accountId || 'unknown'), err?.code || 'SEND_NEW_FAILED');
      if (['SESSION_EXPIRED', 'NO_SESSION', 'AUTHENTICATED_STATE_NOT_REACHED', 'COOKIES_MISSING'].includes(err?.code)) {
        recordSessionExpired(String(req.body?.accountId || 'unknown'), err.code);
      }
      log.error('send_new.failed', {
        accountId: String(req.body?.accountId || 'unknown'),
        errorCode: err?.code || 'SEND_NEW_FAILED',
        error: err,
        retryAfterSec,
      });
      res.status(status).json({
        error: toPublicOperationError(err),
        code: err.code,
        retryAfterSec,
      });
    }
  });
}

module.exports = {
  registerSendRoutes,
};
