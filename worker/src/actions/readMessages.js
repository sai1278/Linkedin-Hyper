'use strict';

const { getAccountContext }        = require('../browser');
const { loadCookies, saveCookies } = require('../session');
const { delay, humanScroll }       = require('../humanBehavior');
const { checkAndIncrement }        = require('../rateLimit');
const { filterRecentConversations } = require('../utils/messageFilter');
const { emitInboxUpdate }          = require('../utils/websocket');

async function readMessages({ accountId, proxyUrl, limit = 20 }) {
  await checkAndIncrement(accountId, 'inboxReads'); // FIRST — before any browser work

  const { context, cookiesLoaded } = await getAccountContext(accountId, proxyUrl);
  let page;

  try {
    // W1 — Only load + inject cookies on a cache miss.
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

    await page.goto('https://www.linkedin.com/messaging/', {
      waitUntil: 'domcontentloaded',
      timeout:   30000,
    });

    // Wait for the actual thread list instead of sleeping blindly.
    // Falls back gracefully if the selector never appears (e.g. empty inbox).
    await page.waitForSelector(
      '.msg-conversation-listitem, [data-view-name="messaging-thread-list-item"]',
      { timeout: 15000 }
    ).catch(() => null);

    // Small human-like jitter only — the content is already there
    await delay(300, 600);

    await humanScroll(page, 300);
    await delay(300, 600);

    const chats = await page.evaluate((maxItems) => {
      const items   = [];
      const threads = document.querySelectorAll(
        '.msg-conversation-listitem, [data-view-name="messaging-thread-list-item"]'
      );

      for (const thread of Array.from(threads).slice(0, maxItems)) {
        try {
          const nameEl    = thread.querySelector('.msg-conversation-listitem__participant-names, .truncate');
          const previewEl = thread.querySelector('.msg-conversation-listitem__message-snippet, .truncate.t-12');
          const timeEl    = thread.querySelector('time, .msg-conversation-listitem__time-stamp');
          const unreadEl  = thread.querySelector('.msg-conversation-listitem__unread-count, [data-test-icon="unread-badge-icon"]');
          const linkEl    = thread.closest('a') || thread.querySelector('a');
          const avatarEl  = thread.querySelector('img');

          const href    = linkEl?.href || '';
          const idMatch = href.match(/\/messaging\/thread\/([^/]+)/);
          const chatId  = idMatch ? idMatch[1] : `unknown-${Date.now()}`;

          items.push({
            id:           chatId,
            accountId:    '', // filled in by caller — not accessible inside browser context
            participants: [{
              id:         chatId,
              name:       nameEl?.textContent?.trim()   || 'Unknown',
              avatarUrl:  avatarEl?.src                 || null,
              profileUrl: null,
            }],
            unreadCount:  unreadEl ? 1 : 0,
            lastMessage:  previewEl ? {
              id:        `preview-${chatId}`,
              chatId,
              senderId:  '',
              text:      previewEl.textContent?.trim() || '',
              createdAt: timeEl?.getAttribute('datetime') || new Date().toISOString(),
              isRead:    !unreadEl,
            } : null,
            createdAt: timeEl?.getAttribute('datetime') || new Date().toISOString(),
          });
        } catch (_) { /* skip malformed item */ }
      }
      return items;
    }, limit);

    // Inject accountId server-side — not available inside browser context
    chats.forEach((c) => { c.accountId = accountId; });

    // Filter to only include conversations from the last hour
    const recentChats = filterRecentConversations(chats);
    
    // Emit WebSocket event for real-time updates
    emitInboxUpdate(accountId, {
      conversations: recentChats,
      total: recentChats.length,
      filteredFrom: chats.length,
    });

    await saveCookies(accountId, await context.cookies());

    return { items: recentChats, cursor: null, hasMore: false };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

module.exports = { readMessages };
