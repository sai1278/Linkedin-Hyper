'use strict';

const { getAccountContext, cleanupContext, withAccountLock } = require('../browser');
const { loadCookies, saveCookies } = require('../session');
const { delay, humanScroll } = require('../humanBehavior');

function isAuthLandingUrl(url) {
  const value = String(url || '').toLowerCase();
  return (
    value.includes('/login') ||
    value.includes('/checkpoint') ||
    value.includes('/authwall') ||
    value.includes('/challenge')
  );
}

function isRecoverableBrowserError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (!msg) return false;

  return (
    msg.includes('session closed') ||
    msg.includes('target page, context or browser has been closed') ||
    msg.includes('frame was detached') ||
    msg.includes('net::err_aborted') ||
    msg.includes('protocol error (page.addscripttoevaluateonnewdocument)') ||
    msg.includes('protocol error (page.createisolatedworld)') ||
    msg.includes('operation failed')
  );
}

function isSyntheticConversationId(chatId) {
  return String(chatId || '').startsWith('fallback-');
}

function normalizeThreadText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function readThreadInternal({
  accountId,
  chatId,
  proxyUrl,
  limit = 50,
  refreshSessionCookies = true,
  __attempt = 1,
  forceCookieReload = false,
}) {
  if (isSyntheticConversationId(chatId)) {
    const err = new Error(`LinkedIn thread ID is unresolved for conversation ${chatId}.`);
    err.code = 'THREAD_ID_UNRESOLVED';
    err.status = 409;
    throw err;
  }

  const { context, cookiesLoaded } = await getAccountContext(accountId, proxyUrl);
  let page;

  try {
    if (!cookiesLoaded || forceCookieReload) {
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

    try {
      await page.goto(`https://www.linkedin.com/messaging/thread/${chatId}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    } catch (navErr) {
      const msg = navErr instanceof Error ? navErr.message : String(navErr);
      if (msg.includes('ERR_TOO_MANY_REDIRECTS')) {
        const err = new Error(`Session expired for account ${accountId}. Re-import cookies.`);
        err.code = 'SESSION_EXPIRED';
        err.status = 401;
        throw err;
      }
      throw navErr;
    }

    const landingUrl = page.url();
    if (isAuthLandingUrl(landingUrl)) {
      if (__attempt < 2 && cookiesLoaded && !forceCookieReload) {
        await cleanupContext(accountId).catch(() => {});
        await delay(250, 500);
        return readThreadInternal({
          accountId,
          chatId,
          proxyUrl,
          limit,
          refreshSessionCookies,
          __attempt: __attempt + 1,
          forceCookieReload: true,
        });
      }

      const err = new Error(`Session expired for account ${accountId}. Re-import cookies.`);
      err.code = 'SESSION_EXPIRED';
      err.status = 401;
      throw err;
    }

    await delay(2000, 3500);

    await page
      .waitForSelector('.msg-s-message-list, [data-view-name="messaging-message-list"]', {
        timeout: 15000,
      })
      .catch(() => null);

    await humanScroll(page, -500);
    await delay(1000, 2000);

    const participant = await page.evaluate(() => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const toAbsolute = (href) => {
        if (!href) return null;
        try {
          return new URL(href, 'https://www.linkedin.com').toString();
        } catch {
          return null;
        }
      };

      const scope =
        document.querySelector('.msg-thread, .msg-overlay-conversation-bubble-header, main') || document;
      const nameEl = scope.querySelector(
        '.msg-thread__name, .msg-entity-lockup__entity-title, [data-anonymize="person-name"], h1, h2, h3'
      );
      const profileLinkEl = scope.querySelector(
        '.msg-thread__link[href*="/in/"], .msg-entity-lockup__entity-title-container a[href*="/in/"], a[href*="/in/"]'
      );

      const name = normalize(nameEl?.textContent) || normalize(profileLinkEl?.textContent) || 'Unknown';
      const profileUrl = toAbsolute(profileLinkEl?.getAttribute('href') || '');

      return { name, profileUrl };
    });

    const messages = await page.evaluate(({ maxItems, currentChatId }) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const stableHash = (value) => {
        const input = String(value || '');
        let hash = 2166136261;
        for (let i = 0; i < input.length; i += 1) {
          hash ^= input.charCodeAt(i);
          hash = Math.imul(hash, 16777619);
        }
        return Math.abs(hash >>> 0).toString(36);
      };
      const parseLooseTimestamp = (rawLabel) => {
        const label = normalize(rawLabel).toLowerCase();
        if (!label) return '';

        const now = new Date();
        const timeMatch = label.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
        if (timeMatch) {
          const hoursRaw = Number(timeMatch[1]);
          const minutes = Number(timeMatch[2]);
          const meridiem = timeMatch[3].toLowerCase();
          let hours = hoursRaw % 12;
          if (meridiem === 'pm') hours += 12;
          const candidate = new Date(now);
          candidate.setHours(hours, minutes, 0, 0);
          if (candidate.getTime() > now.getTime() + 5 * 60 * 1000) {
            candidate.setDate(candidate.getDate() - 1);
          }
          return candidate.toISOString();
        }

        if (label === 'yesterday') {
          const candidate = new Date(now);
          candidate.setDate(candidate.getDate() - 1);
          return candidate.toISOString();
        }

        const relativeMatch = label.match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|month|months)$/);
        if (relativeMatch) {
          const amount = Number(relativeMatch[1]);
          const unit = relativeMatch[2];
          const candidate = new Date(now);

          if (['m', 'min', 'mins', 'minute', 'minutes'].includes(unit)) {
            candidate.setMinutes(candidate.getMinutes() - amount);
          } else if (['h', 'hr', 'hrs', 'hour', 'hours'].includes(unit)) {
            candidate.setHours(candidate.getHours() - amount);
          } else if (['d', 'day', 'days'].includes(unit)) {
            candidate.setDate(candidate.getDate() - amount);
          } else if (['w', 'wk', 'wks', 'week', 'weeks'].includes(unit)) {
            candidate.setDate(candidate.getDate() - (amount * 7));
          } else if (['mo', 'month', 'months'].includes(unit)) {
            candidate.setMonth(candidate.getMonth() - amount);
          } else {
            return '';
          }

          return candidate.toISOString();
        }

        return '';
      };
      const extractStableMessageId = (item, bodyEl, timeEl, senderName, text, isSelf) => {
        const candidates = [
          item.getAttribute('data-event-urn') || '',
          item.getAttribute('data-urn') || '',
          item.getAttribute('data-message-id') || '',
          item.getAttribute('data-id') || '',
          item.getAttribute('id') || '',
          bodyEl?.getAttribute?.('data-event-urn') || '',
          bodyEl?.getAttribute?.('data-urn') || '',
          bodyEl?.getAttribute?.('data-message-id') || '',
          bodyEl?.getAttribute?.('data-id') || '',
          bodyEl?.getAttribute?.('id') || '',
        ];

        for (const candidate of candidates) {
          const normalizedCandidate = normalize(candidate);
          if (!normalizedCandidate) continue;
          const urnMatch = normalizedCandidate.match(/fsd?_message:([^,\s)]+)/i);
          if (urnMatch?.[1]) {
            return `li-msg-${urnMatch[1]}`;
          }
          const directIdMatch = normalizedCandidate.match(/message[:/=-]([^,\s)]+)/i);
          if (directIdMatch?.[1]) {
            return `li-msg-${directIdMatch[1]}`;
          }
          if (!normalizedCandidate.includes('msg-s-event') && normalizedCandidate.length <= 128) {
            return `li-msg-${stableHash(normalizedCandidate)}`;
          }
        }

        const senderKey = isSelf ? '__self__' : normalize(senderName).toLowerCase();
        const textKey = normalize(text).toLowerCase();
        const timeKey = normalize(timeEl?.getAttribute?.('datetime') || timeEl?.textContent || '').toLowerCase();
        return `li-msg-${stableHash([currentChatId, senderKey, textKey, timeKey].join('|'))}`;
      };

      const results = [];
      const items = document.querySelectorAll(
        '.msg-s-event-listitem, [data-view-name="messaging-message-list-item"]'
      );

      for (const item of Array.from(items).slice(-maxItems)) {
        try {
          const bodyEl = item.querySelector('.msg-s-event__content, .body');
          const timeEl = item.querySelector('time');
          const senderEl = item.querySelector('.msg-s-message-group__profile-link, .msg-s-event__link');
          const senderNameEl = item.querySelector(
            '.msg-s-message-group__name, .msg-s-message-group__profile-link, .msg-s-event__link, [data-anonymize="person-name"]'
          );
          const isSelf =
            item.classList.contains('msg-s-message-list__event--own-turn') ||
            item.querySelector('[data-view-name="messaging-self-message"]') !== null;

          if (!bodyEl) continue;

          const text = normalize(bodyEl.textContent);
          if (!text) continue;
          const senderName = isSelf ? '__self__' : normalize(senderNameEl?.textContent) || 'Unknown';
          const createdAt =
            timeEl?.getAttribute('datetime') ||
            parseLooseTimestamp(timeEl?.textContent || '') ||
            '';
          const msgId = extractStableMessageId(item, bodyEl, timeEl, senderName, text, isSelf);

          results.push({
            id: msgId,
            chatId: '',
            senderId: isSelf ? '__self__' : senderEl?.href?.match(/\/in\/([^/]+)/)?.[1] || 'other',
            text,
            createdAt,
            senderName,
            isRead: true,
          });
        } catch (_) {
          // skip malformed items
        }
      }

      return results;
    }, { maxItems: limit, currentChatId: chatId });

    messages.forEach((m) => {
      m.chatId = chatId;
      if (m.senderId === '__self__') {
        m.senderName = accountId;
      }
    });

    if (participant?.name === 'Unknown') {
      const firstOther = messages.find(
        (m) => m.senderId !== '__self__' && m.senderName && m.senderName !== 'Unknown'
      );
      if (firstOther?.senderName) {
        participant.name = firstOther.senderName;
      }
    }

    if (refreshSessionCookies && process.env.REFRESH_SESSION_COOKIES === '1') {
      await saveCookies(accountId, await context.cookies(), {
        skipIfMissingAuthCookies: true,
        source: 'readThread',
      });
    }

    return { items: messages, participant, cursor: null, hasMore: false };
  } catch (err) {
    if (__attempt < 2 && isRecoverableBrowserError(err)) {
      await cleanupContext(accountId).catch(() => {});
      await delay(250, 500);
      return readThreadInternal({
        accountId,
        chatId,
        proxyUrl,
        limit,
        refreshSessionCookies,
        __attempt: __attempt + 1,
        forceCookieReload: true,
      });
    }
    throw err;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

async function readThread({ accountId, chatId, proxyUrl, limit = 50, refreshSessionCookies = true }) {
  return withAccountLock(accountId, async () =>
    readThreadInternal({
      accountId,
      chatId,
      proxyUrl,
      limit,
      refreshSessionCookies,
      __attempt: 1,
      forceCookieReload: false,
    })
  );
}

module.exports = { readThread };
