'use strict';

const { getAccountContext }        = require('../browser');
const { loadCookies, saveCookies } = require('../session');
const { delay, humanScroll }       = require('../humanBehavior');

async function readThread({ accountId, chatId, proxyUrl, limit = 50 }) {
  // No rate limit — reading is passive
  const { context, cookiesLoaded } = await getAccountContext(accountId, proxyUrl);
  let page;

  try {
    // W1 — Only inject cookies on a cache miss.
    if (!cookiesLoaded) {
      const cookies = await loadCookies(accountId);
      if (!cookies) {
        const err = new Error(`No session for account ${accountId}`);
        err.code = 'NO_SESSION'; err.status = 401;
        throw err;
      }
      await context.addCookies(cookies);
    }
    page = await context.newPage();

    await page.goto(`https://www.linkedin.com/messaging/thread/${chatId}/`, {
      waitUntil: 'domcontentloaded',
      timeout:   30000,
    });

    await delay(2000, 3500);

    await page.waitForSelector('.msg-s-message-list, [data-view-name="messaging-message-list"]', {
      timeout: 15000,
    }).catch(() => null);

    await humanScroll(page, -500); // scroll UP to load older messages
    await delay(1000, 2000);

    const messages = await page.evaluate((maxItems) => {
      const results = [];
      const items   = document.querySelectorAll(
        '.msg-s-event-listitem, [data-view-name="messaging-message-list-item"]'
      );

      for (const item of Array.from(items).slice(-maxItems)) {
        try {
          const bodyEl      = item.querySelector('.msg-s-event__content, .body');
          const timeEl      = item.querySelector('time');
          const senderEl    = item.querySelector('.msg-s-message-group__profile-link, .msg-s-event__link');
          const senderNameEl = item.querySelector(
            '.msg-s-message-group__name, .msg-s-message-group__profile-link, .msg-s-event__link, [data-anonymize="person-name"]'
          );
          // Two separate checks for self-message detection
          const isSelf = item.classList.contains('msg-s-message-list__event--own-turn') ||
                         item.querySelector('[data-view-name="messaging-self-message"]') !== null;

          if (!bodyEl) continue;

          const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

          results.push({
            id:        msgId,
            chatId:    '', // filled by caller
            senderId:  isSelf ? '__self__' : (senderEl?.href?.match(/\/in\/([^/]+)/)?.[1] || 'other'),
            text:      bodyEl.textContent?.trim() || '',
            createdAt: timeEl?.getAttribute('datetime') || new Date().toISOString(),
            senderName: isSelf
              ? '__self__'                                      // intermediate sentinel
              : (senderNameEl?.textContent?.trim() || 'Unknown'),
            isRead: true,
          });
        } catch (_) { /* skip malformed */ }
      }
      return results;
    }, limit);

    messages.forEach((m) => {
      m.chatId = chatId;
      // Replace sentinel with real account ID for self-messages
      if (m.senderId === '__self__') {
        m.senderName = accountId;
      }
    });

    await saveCookies(accountId, await context.cookies());

    return { items: messages, cursor: null, hasMore: false };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

module.exports = { readThread };
