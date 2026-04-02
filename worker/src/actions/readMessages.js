'use strict';

const { getAccountContext, withAccountLock } = require('../browser');
const { loadCookies, saveCookies } = require('../session');
const { delay, humanScroll }       = require('../humanBehavior');
const { checkAndIncrement }        = require('../rateLimit');

async function readMessages({ accountId, proxyUrl, limit = 20 }) {
  return withAccountLock(accountId, async () => {
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
      const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const toAbsoluteLinkedInUrl = (href) => {
        if (!href) return null;
        try {
          return new URL(href, 'https://www.linkedin.com').toString();
        } catch {
          return null;
        }
      };
      const stableHash = (value) => {
        let hash = 0;
        const input = String(value || '');
        for (let i = 0; i < input.length; i += 1) {
          hash = (hash << 5) - hash + input.charCodeAt(i);
          hash |= 0;
        }
        return Math.abs(hash).toString(36);
      };
      const extractNameFromAriaLabel = (aria) => {
        const value = normalizeText(aria);
        if (!value) return '';
        const patterns = [
          /^conversation with (.+)$/i,
          /^message with (.+)$/i,
          /^chat with (.+)$/i,
        ];
        for (const pattern of patterns) {
          const match = value.match(pattern);
          if (match && match[1]) return normalizeText(match[1]);
        }
        return '';
      };
      const extractThreadId = (thread, href, participantName, profileUrl, idx) => {
        const candidates = [
          href || '',
          thread.getAttribute('data-conversation-id') || '',
          thread.getAttribute('data-urn') || '',
          thread.getAttribute('data-id') || '',
          thread.getAttribute('id') || '',
        ];

        for (const candidate of candidates) {
          if (!candidate) continue;

          const directMatch = candidate.match(/\/messaging\/thread\/([^/?#]+)/i);
          if (directMatch?.[1]) return directMatch[1];

          const urnMatch = candidate.match(/fs_conversation:([^,\s)]+)/i);
          if (urnMatch?.[1]) return urnMatch[1];

          const queryMatch = candidate.match(/[?&](?:conversationId|conversationUrn|threadId)=([^&#]+)/i);
          if (queryMatch?.[1]) {
            try {
              return decodeURIComponent(queryMatch[1]);
            } catch {
              return queryMatch[1];
            }
          }
        }

        const fallbackKey = `${participantName}|${profileUrl || ''}|${href || ''}|${idx}`;
        return `fallback-${stableHash(fallbackKey)}`;
      };

      const items   = [];
      const threads = document.querySelectorAll(
        '.msg-conversation-listitem, [data-view-name="messaging-thread-list-item"]'
      );

      for (const [idx, thread] of Array.from(threads).slice(0, maxItems).entries()) {
        try {
          const nameEl    = thread.querySelector(
            '.msg-conversation-listitem__participant-names, .msg-conversation-listitem__participant-names span, .truncate, [data-anonymize="person-name"], .msg-conversation-listitem__name'
          );
          const previewEl = thread.querySelector('.msg-conversation-listitem__message-snippet, .truncate.t-12');
          const timeEl    = thread.querySelector('time, .msg-conversation-listitem__time-stamp');
          const unreadEl  = thread.querySelector('.msg-conversation-listitem__unread-count, [data-test-icon="unread-badge-icon"]');
          const linkEl    = thread.closest('a') || thread.querySelector('a');
          const profileLinkEl = thread.querySelector('a[href*="/in/"]');
          const avatarEl  = thread.querySelector('img');
          const ariaLabel = thread.getAttribute('aria-label') || linkEl?.getAttribute('aria-label') || '';

          const href = linkEl?.href || '';
          const profileUrl = toAbsoluteLinkedInUrl(profileLinkEl?.getAttribute('href') || '');
          const nameFromAria = extractNameFromAriaLabel(ariaLabel);
          const rawName =
            normalizeText(nameEl?.textContent) ||
            normalizeText(profileLinkEl?.textContent) ||
            nameFromAria;
          const participantName = rawName || 'Unknown';
          const chatId = extractThreadId(thread, href, participantName, profileUrl, idx);

          items.push({
            id:           chatId,
            accountId:    '', // filled in by caller — not accessible inside browser context
            participants: [{
              id:         chatId,
              name:       participantName,
              avatarUrl:  avatarEl?.src                 || null,
              profileUrl,
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
  });
}

module.exports = { readMessages };
