'use strict';

const { getAccountContext, cleanupContext, withAccountLock } = require('../../browser');
const { loadCookies } = require('../../session');
const { delay, humanClick, humanScroll, humanType } = require('../../humanBehavior');
const { checkAndIncrement } = require('../../rateLimit');
const common = require('./common');
const {
  COMPOSER_SELECTORS: composeSelectors,
  PROFILE_DIRECT_MESSAGE_SELECTORS,
  PROFILE_TOP_ACTION_SELECTORS,
  normalizeParticipantName,
  normalizeProfileUrlForCompare,
} = common;
const {
  logSendStep,
  collectProfileActionDebugSnapshot,
  logProfileActionDebug,
  captureFailureScreenshot,
} = require('./diagnostics');
const { gotoMessagingHomeLenient } = require('./browserSurfaceHelpers');
const { clickMessageTriggerOnProfile, openComposerFromPeopleSearch } = require('./profileResolver');
const { openComposerFromMessagingHome } = require('./messageComposer');
const { isComposerDraftCleared, detectSendErrorBanner } = require('./sendConfirmation');
const { isRecoverableBrowserError, wrapSendError } = require('./retryPolicy');
const { refreshSessionCookiesIfEnabled, recordSentMessageActivity } = require('./persistence');
const { createSendMessageThreadHelpers } = require('../sendMessageThreadHelpers');

const {
  normalizeThreadIdCandidate: normalizeThreadId,
  isValidThreadId,
  createNetworkThreadIdProbe,
  extractThreadIdFromText,
  getMessageSnapshot,
  verifyMessageEcho,
  resolveThreadIdAfterSend,
  resolveThreadIdFromCurrentMessagingView,
  resolveThreadIdFromConversationPreview,
  resolveThreadIdFromMessagingHome,
  resolveThreadIdByClickingConversationCandidates,
  confirmMessagePersistedInThread,
  confirmMessageVisibleInCurrentView,
} = createSendMessageThreadHelpers({
  delay,
  normalizeText: common.normalizeText,
  slugToName: common.slugToName,
  normalizeProfileUrlForCompare,
  gotoMessagingHomeLenient,
  logSendStep,
  truncateForLog: common.truncateForLog,
});

async function sendMessageNewInternal({ accountId, profileUrl, chatId, text, proxyUrl, __attempt = 1 }) {
  await cleanupContext(accountId).catch(() => {});
  const { context, cookiesLoaded } = await getAccountContext(accountId, proxyUrl);
  let page;
  let networkThreadProbe = null;
  let preResolvedChatId = '';
  const directThreadId = isValidThreadId(chatId) ? normalizeThreadId(chatId) : '';

  try {
    if (!cookiesLoaded) {
      const cookies = await loadCookies(accountId);
      if (!cookies) {
        const err = new Error(`No session for account ${accountId}`);
        err.code = 'NO_SESSION';
        err.status = 401;
        throw err;
      }
      await context.addCookies(cookies);
    }
    page = await context.newPage();

    let participantName = normalizeParticipantName('', profileUrl);
    let usedDirectUrl = false;

    if (directThreadId) {
      logSendStep(accountId, `opening existing thread: ${directThreadId}`);
      try {
        await page.goto(`https://www.linkedin.com/messaging/thread/${directThreadId}/`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
      } catch (navErr) {
        const navMsg = String(navErr?.message || navErr);
        if (navMsg.includes('ERR_TOO_MANY_REDIRECTS')) {
          const err = new Error(`Session expired for account ${accountId}. Re-import cookies.`);
          err.code = 'SESSION_EXPIRED';
          err.status = 401;
          throw err;
        }
        throw navErr;
      }

      if (common.isAuthwallUrl(page.url())) {
        const err = new Error(`Session expired for account ${accountId}. Re-import cookies.`);
        err.code = 'SESSION_EXPIRED';
        err.status = 401;
        throw err;
      }

      const threadComposer = await page
        .waitForSelector(composeSelectors, { timeout: 20000 })
        .catch(() => null);

      if (threadComposer) {
        usedDirectUrl = true;
        preResolvedChatId = directThreadId;

        try {
          const candidateName = await page.evaluate(() => {
            const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const nameEl = document.querySelector(
              '.msg-thread__name, .msg-entity-lockup__entity-title, [data-anonymize="person-name"], h1, h2'
            );
            return normalize(nameEl?.textContent || '');
          });
          if (candidateName) {
            participantName = normalizeParticipantName(candidateName, profileUrl);
          }
        } catch (_) {}
      }

      if (!usedDirectUrl) {
        const err = new Error('Existing LinkedIn thread is not replyable because the composer could not be opened.');
        err.code = 'THREAD_NOT_REPLYABLE';
        err.status = 409;
        throw err;
      }
    }

    if (!usedDirectUrl) {
      try {
        const existingThreadId = await resolveThreadIdFromMessagingHome(
          page,
          { accountId, profileUrl, participantName, messageText: '' },
          12000
        );
        if (isValidThreadId(existingThreadId)) {
          await page.goto(`https://www.linkedin.com/messaging/thread/${existingThreadId}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          const threadComposer = await page
            .waitForSelector(composeSelectors, { timeout: 20000 })
            .catch(() => null);
          if (threadComposer) {
            usedDirectUrl = true;
            preResolvedChatId = existingThreadId;
          }
        }
      } catch (_) {}
    }

    if (!usedDirectUrl) {
      try {
        const messagingComposerResult = await openComposerFromMessagingHome(page, {
          accountId,
          profileUrl,
          participantName,
        }, {
          resolveThreadIdFromCurrentMessagingView,
          extractThreadIdFromText,
          isValidThreadId,
        });
        if (messagingComposerResult.opened) {
          usedDirectUrl = true;
          if (messagingComposerResult.threadId) {
            preResolvedChatId = messagingComposerResult.threadId;
          }
          logSendStep(accountId, `composer opened via messaging home fallback (${messagingComposerResult.matched})`);
        } else {
          logSendStep(accountId, `messaging-home fallback unavailable: ${messagingComposerResult.reason}`);
        }
      } catch (_) {}
    }

    if (!usedDirectUrl) {
      try {
        const conversationThreadId = await resolveThreadIdByClickingConversationCandidates(
          page,
          { accountId, profileUrl, participantName, messageText: '' },
          15000
        );
        if (isValidThreadId(conversationThreadId)) {
          await page.goto(`https://www.linkedin.com/messaging/thread/${conversationThreadId}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          const threadComposer = await page
            .waitForSelector(composeSelectors, { timeout: 15000 })
            .catch(() => null);
          if (threadComposer) {
            usedDirectUrl = true;
            preResolvedChatId = conversationThreadId;
            logSendStep(accountId, `composer opened via conversation-list fallback (thread=${conversationThreadId})`);
          } else {
            logSendStep(accountId, 'conversation-list fallback found thread but composer was unavailable');
          }
        } else {
          logSendStep(accountId, 'conversation-list fallback did not resolve a target thread');
        }
      } catch (err) {
        logSendStep(accountId, `conversation-list fallback unavailable: ${String(err?.message || err)}`);
      }
    }

    if (!usedDirectUrl) {
      try {
        const searchComposerResult = await openComposerFromPeopleSearch(page, {
          accountId,
          profileUrl,
          participantName,
        });
        if (searchComposerResult.opened) {
          usedDirectUrl = true;
          logSendStep(accountId, 'composer opened via people-search fallback');
        } else {
          logSendStep(accountId, `people-search fallback unavailable: ${searchComposerResult.reason}`);
        }
      } catch (_) {}
    }

    if (!usedDirectUrl) {
      logSendStep(accountId, `opening profile URL: ${profileUrl}`);
      try {
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (navErr) {
        const navMsg = String(navErr?.message || navErr);
        const wrappedErr = new Error(`Profile navigation failed while opening message composer: ${navMsg}`);
        const navMsgLower = navMsg.toLowerCase();
        if (navMsgLower.includes('err_too_many_redirects')) {
          wrappedErr.code = 'NAVIGATION_REDIRECT_LOOP';
        } else if (navMsgLower.includes('timeout')) {
          wrappedErr.code = 'PROFILE_NAVIGATION_TIMEOUT';
        } else {
          wrappedErr.code = 'PROFILE_NAVIGATION_FAILED';
        }
        wrappedErr.status = 502;
        throw wrappedErr;
      }
      await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
      await page.waitForSelector('main, body', { timeout: 15000 }).catch(() => null);
      logSendStep(accountId, `profile page load successful: ${page.url()}`);
      const profileDebugSnapshot = await collectProfileActionDebugSnapshot(page, {
        messageSelectors: [
          ...PROFILE_DIRECT_MESSAGE_SELECTORS,
          ...PROFILE_TOP_ACTION_SELECTORS,
        ],
        moreSelectors: common.PROFILE_MORE_ACTION_SELECTORS,
      });
      logProfileActionDebug(accountId, profileDebugSnapshot);
      if (profileDebugSnapshot?.error) {
        logSendStep(accountId, `[debug] profile debug collection error: ${profileDebugSnapshot.error}`);
      }

      const landingUrl = page.url();
      if (landingUrl.includes('/login') || landingUrl.includes('/checkpoint') || landingUrl.includes('/authwall')) {
        const authwallShot = await captureFailureScreenshot(page, accountId, 'profile-authwall');
        const err = new Error(`Session expired for account ${accountId}. Re-import cookies.`);
        if (authwallShot) {
          err.message += ` Screenshot: ${authwallShot}`;
        }
        err.code = 'SESSION_EXPIRED';
        err.status = 401;
        throw err;
      }
      await delay(2500, 5000);

      await humanScroll(page, 200);
      await delay(800, 1500);

      try {
        const candidateName = await page.evaluate((fallbackName) => {
          const messageButton = document.querySelector('button[aria-label*="Message"], a[aria-label*="Message"]');
          const nearestCard = messageButton?.closest('.pv-top-card, .ph5, .artdeco-card, main, section');
          const scopedName = nearestCard?.querySelector('h1, [data-anonymize="person-name"], .text-heading-xlarge');
          const fallbackEl = document.querySelector('h1, [data-anonymize="person-name"], .text-heading-xlarge');
          const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
          const raw = scopedName?.textContent || fallbackEl?.textContent || '';
          return normalize(raw) || fallbackName || 'Unknown';
        }, participantName);
        participantName = normalizeParticipantName(candidateName, profileUrl);
      } catch (_) {}

      const openComposerResult = await clickMessageTriggerOnProfile(page, {
        accountId,
        profileUrl,
        maxAttempts: 3,
      });
      if (!openComposerResult.opened) {
        const screenshotInfo = openComposerResult.screenshotPath
          ? ` Screenshot: ${openComposerResult.screenshotPath}`
          : '';
        const reason = openComposerResult.reason
          || 'Profile is not messageable for this account or LinkedIn UI does not expose a usable Message control.';
        const err = new Error(`Could not open message composer from profile. ${reason}${screenshotInfo}`);
        err.code = 'NOT_MESSAGEABLE';
        err.status = 400;
        throw err;
      }
      logSendStep(
        accountId,
        `composer opened successfully via ${openComposerResult.strategy} (${openComposerResult.matched})`
      );
      await delay(1500, 3000);
    }

    const beforeSnapshot = await getMessageSnapshot(page).catch(() => ({ count: 0, lastText: '', recentTexts: [] }));
    try {
      await humanType(page, composeSelectors, text, { timeout: 20000 });
    } catch (typeErr) {
      const typeScreenshot = await captureFailureScreenshot(page, accountId, 'composer-input-not-found');
      const msg = String(typeErr?.message || typeErr || '');
      if (msg.includes('waitForSelector') || msg.includes('contenteditable') || msg.includes('textarea')) {
        const err = new Error(
          `Message composer input not available after opening chat. Ensure recipient is messageable for this account.` +
          (typeScreenshot ? ` Screenshot: ${typeScreenshot}` : '')
        );
        err.code = 'NOT_MESSAGEABLE';
        err.status = 400;
        throw err;
      }
      throw typeErr;
    }
    await delay(800, 1800);

    networkThreadProbe = createNetworkThreadIdProbe(page);
    await humanClick(page, '.msg-form__send-button, button[type="submit"][aria-label*="Send"]');
    const verified = await verifyMessageEcho(page, text, beforeSnapshot);
    if (!verified) {
      const err = new Error('Message send could not be confirmed in thread. Retry once with fresh session.');
      err.code = 'SEND_NOT_CONFIRMED';
      err.status = 502;
      throw err;
    }

    let resolvedChatId = preResolvedChatId || (await resolveThreadIdAfterSend(page, 12000));
    if (!resolvedChatId) {
      logSendStep(accountId, 'thread id unresolved after URL probe; waiting on network probe');
      resolvedChatId = await networkThreadProbe.waitForThreadId(12000);
    }
    if (!resolvedChatId) {
      logSendStep(accountId, 'thread id unresolved after network probe; trying conversation preview match');
      resolvedChatId = await resolveThreadIdFromConversationPreview(page, text, 12000);
    }
    if (!resolvedChatId) {
      logSendStep(accountId, 'thread id unresolved after preview match; scanning messaging home');
      resolvedChatId = await resolveThreadIdFromMessagingHome(
        page,
        { accountId, profileUrl, participantName, messageText: text },
        20000
      );
    }
    if (!resolvedChatId) {
      logSendStep(accountId, 'thread id unresolved after messaging-home scan; opening ranked conversation rows');
      resolvedChatId = await resolveThreadIdByClickingConversationCandidates(
        page,
        { accountId, profileUrl, participantName, messageText: text },
        25000
      );
    }
    if (!resolvedChatId) {
      const messageStillVisible = await confirmMessageVisibleInCurrentView(page, text, 15000);
      const composerCleared = await isComposerDraftCleared(page);
      const hasSendErrorBanner = await detectSendErrorBanner(page);
      const unresolvedShot = await captureFailureScreenshot(page, accountId, 'thread-id-unresolved');
      const err = new Error(
        `Send clicked but LinkedIn thread ID was not resolved. Delivery could not be confirmed (visible=${messageStillVisible}, composerCleared=${composerCleared}, errorBanner=${hasSendErrorBanner}).` +
          (unresolvedShot ? ` Screenshot: ${unresolvedShot}` : '')
      );
      err.code = 'SEND_NOT_CONFIRMED';
      err.status = 502;
      throw err;
    }

    const persisted = await confirmMessagePersistedInThread(page, resolvedChatId, text, 30000);
    if (!persisted) {
      const persistedShot = await captureFailureScreenshot(page, accountId, 'message-not-found-after-send');
      const err = new Error(
        'Message was not found in thread after send confirmation. Message may not be delivered.' +
        (persistedShot ? ` Screenshot: ${persistedShot}` : '')
      );
      err.code = 'SEND_NOT_CONFIRMED';
      err.status = 502;
      throw err;
    }

    await checkAndIncrement(accountId, 'messagesSent');
    await delay(2000, 4000);

    await refreshSessionCookiesIfEnabled(accountId, context);
    await recordSentMessageActivity({ accountId, participantName, profileUrl, text });

    return {
      id: `sent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      chatId: resolvedChatId,
      senderId: '__self__',
      text,
      createdAt: new Date().toISOString(),
      isRead: true,
    };
  } catch (err) {
    if (__attempt < 3 && isRecoverableBrowserError(err)) {
      await cleanupContext(accountId).catch(() => {});
      await delay(700 + (__attempt * 300), 1300 + (__attempt * 300));
      return sendMessageNewInternal({ accountId, profileUrl, chatId, text, proxyUrl, __attempt: __attempt + 1 });
    }

    throw wrapSendError(accountId, err);
  } finally {
    if (networkThreadProbe) {
      networkThreadProbe.stop();
    }
    if (page) await page.close().catch(() => {});
  }
}

async function sendMessageNew({ accountId, profileUrl, chatId, text, proxyUrl }) {
  return withAccountLock(accountId, async () =>
    sendMessageNewInternal({ accountId, profileUrl, chatId, text, proxyUrl, __attempt: 1 })
  );
}

module.exports = { sendMessageNew };
