'use strict';

const { getAccountContext }        = require('../browser');
const { loadCookies, saveCookies } = require('../session');
const { delay, humanScroll }       = require('../humanBehavior');
const { checkAndIncrement }        = require('../rateLimit');

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

    try {
      await page.goto('https://www.linkedin.com/messaging/', {
        waitUntil: 'domcontentloaded',
        timeout:   30000,
      });
    } catch (navErr) {
      const msg = navErr instanceof Error ? navErr.message : String(navErr);
      if (msg.includes('ERR_TOO_MANY_REDIRECTS')) {
        const err = new Error(`Session expired for account ${accountId}. Re-import cookies.`);
        err.code = 'SESSION_EXPIRED'; err.status = 401;
        throw err;
      }
      throw navErr;
    }

    const landingUrl = page.url();
    if (landingUrl.includes('/login') || landingUrl.includes('/checkpoint') || landingUrl.includes('/authwall')) {
      const err = new Error(`Session expired for account ${accountId}. Re-import cookies.`);
      err.code = 'SESSION_EXPIRED'; err.status = 401;
      throw err;
    }

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

      for (const [idx, thread] of Array.from(threads).slice(0, maxItems).entries()) {
        try {
          const nameEl    = thread.querySelector('.msg-conversation-listitem__participant-names, .truncate');
          const previewEl = thread.querySelector('.msg-conversation-listitem__message-snippet, .truncate.t-12');
          const timeEl    = thread.querySelector('time, .msg-conversation-listitem__time-stamp');
          const unreadEl  = thread.querySelector('.msg-conversation-listitem__unread-count, [data-test-icon="unread-badge-icon"]');
          const linkEl    = thread.closest('a') || thread.querySelector('a');
          const avatarEl  = thread.querySelector('img');

          const href = linkEl?.href || '';
          const idMatch = href.match(/\/messaging\/thread\/([^/?]+)/);
          const chatId = idMatch ? idMatch[1] : `unknown-${Date.now()}-${idx}`;

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

    if (process.env.REFRESH_SESSION_COOKIES === '1') {
      await saveCookies(accountId, await context.cookies());
    }

    return { items: chats, cursor: null, hasMore: false };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

module.exports = { readMessages };
