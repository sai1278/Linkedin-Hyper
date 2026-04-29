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

const THREAD_MESSAGE_SELECTOR = [
  '.msg-s-event-listitem',
  '.msg-s-message-list__event',
  '.msg-s-message-list__event--own-turn',
  '.msg-s-message-list__event--other-turn',
  '[data-view-name="messaging-message-list-item"]',
  '[data-view-name="messaging-self-message"]',
  '[data-view-name="messaging-remote-message"]',
].join(', ');

function getThreadSnapshotMessageKey(item) {
  const stableId = String(item?.id || '').trim();
  if (stableId) {
    return `id:${stableId}`;
  }

  return [
    String(item?.chatId || ''),
    String(item?.senderId || ''),
    normalizeThreadText(item?.senderName || '').toLowerCase(),
    normalizeThreadText(item?.text || '').toLowerCase(),
    String(item?.createdAt || ''),
    String(item?.rawTimeLabel || '').toLowerCase(),
  ].join('|');
}

function mergeThreadSnapshotItems(existingItems, incomingItems, limit) {
  const merged = new Map();

  for (const item of [...(existingItems || []), ...(incomingItems || [])]) {
    if (!item) continue;
    const normalizedItem = {
      ...item,
      text: normalizeThreadText(item?.text || ''),
      senderName: item?.senderName || 'Unknown',
      rawTimeLabel: normalizeThreadText(item?.rawTimeLabel || ''),
      hasExactTimestamp: item?.hasExactTimestamp === true,
    };
    const key = getThreadSnapshotMessageKey(normalizedItem);
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, normalizedItem);
      continue;
    }

    merged.set(key, {
      ...previous,
      ...normalizedItem,
      id: previous.id || normalizedItem.id,
      createdAt: previous.createdAt || normalizedItem.createdAt,
      rawTimeLabel: previous.rawTimeLabel || normalizedItem.rawTimeLabel,
      hasExactTimestamp: previous.hasExactTimestamp || normalizedItem.hasExactTimestamp,
    });
  }

  return Array.from(merged.values())
    .sort((left, right) => {
      const leftTime = Date.parse(left?.createdAt || '');
      const rightTime = Date.parse(right?.createdAt || '');

      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime;
      }

      return normalizeThreadText(left?.text || '').localeCompare(normalizeThreadText(right?.text || ''));
    })
    .slice(-limit);
}

function mergeThreadParticipant(existingParticipant, incomingParticipant) {
  const existingName = normalizeThreadText(existingParticipant?.name || '');
  const incomingName = normalizeThreadText(incomingParticipant?.name || '');
  const existingProfileUrl = String(existingParticipant?.profileUrl || '').trim();
  const incomingProfileUrl = String(incomingParticipant?.profileUrl || '').trim();

  return {
    name: existingName && existingName !== 'Unknown' ? existingName : (incomingName || 'Unknown'),
    profileUrl: existingProfileUrl || incomingProfileUrl || null,
  };
}

async function extractThreadSnapshot(page, chatId, limit) {
  return page.evaluate(({ maxItems, currentChatId, messageSelector }) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const pickBestMessageText = (root) => {
      if (!root) return '';

      const selectorCandidates = [
        '.msg-s-event__content',
        '.msg-s-event__content [dir]',
        '.msg-s-event__message',
        '[data-view-name="messaging-message-body"]',
        '[data-test-message-text]',
        '.break-words',
        '.body',
      ];

      const candidates = Array.from(
        new Set(
          [
            root,
            ...selectorCandidates.flatMap((selector) => Array.from(root.querySelectorAll(selector) || [])),
          ]
        )
      )
        .map((node) => normalize(node?.textContent))
        .filter(Boolean)
        .sort((left, right) => right.length - left.length);

      return candidates[0] || '';
    };
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
    const collectCandidateAttributes = (root) => {
      const values = [];
      if (!root) return values;

      const pushValue = (value) => {
        const normalizedValue = normalize(value);
        if (normalizedValue) values.push(normalizedValue);
      };

      const nodes = [root, ...Array.from(root.querySelectorAll?.('[data-event-urn],[data-urn],[data-message-id],[data-id],[id]') || [])];
      for (const node of nodes) {
        pushValue(node.getAttribute?.('data-event-urn'));
        pushValue(node.getAttribute?.('data-urn'));
        pushValue(node.getAttribute?.('data-message-id'));
        pushValue(node.getAttribute?.('data-id'));
        pushValue(node.getAttribute?.('id'));
      }
      return values;
    };
    const extractStableMessageId = (item, bodyEl, timeEl, senderName, text, isSelf) => {
      const candidates = [
        ...collectCandidateAttributes(item),
        ...collectCandidateAttributes(bodyEl),
      ];

      for (const candidate of candidates) {
        const urnMatch = candidate.match(/fsd?_message:([^,\s)]+)/i);
        if (urnMatch?.[1]) {
          return `li-msg-${urnMatch[1]}`;
        }
        const directIdMatch = candidate.match(/message[:/=-]([^,\s)]+)/i);
        if (directIdMatch?.[1]) {
          return `li-msg-${directIdMatch[1]}`;
        }
      }

      const senderKey = isSelf ? '__self__' : normalize(senderName).toLowerCase();
      const textKey = normalize(text).toLowerCase();
      const timeKey = normalize(timeEl?.getAttribute?.('datetime') || timeEl?.textContent || '').toLowerCase();
      return `li-msg-${stableHash([currentChatId, senderKey, textKey, timeKey].join('|'))}`;
    };

    const participantScope =
      document.querySelector('.msg-thread, .msg-overlay-conversation-bubble-header, main') || document;
    const participantNameEl = participantScope.querySelector(
      '.msg-thread__name, .msg-entity-lockup__entity-title, [data-anonymize="person-name"], h1, h2, h3'
    );
    const participantProfileLinkEl = participantScope.querySelector(
      '.msg-thread__link[href*="/in/"], .msg-entity-lockup__entity-title-container a[href*="/in/"], a[href*="/in/"]'
    );
    const toAbsolute = (href) => {
      if (!href) return null;
      try {
        return new URL(href, 'https://www.linkedin.com').toString();
      } catch {
        return null;
      }
    };

    const participant = {
      name: normalize(participantNameEl?.textContent) || normalize(participantProfileLinkEl?.textContent) || 'Unknown',
      profileUrl: toAbsolute(participantProfileLinkEl?.getAttribute('href') || ''),
    };

    const results = [];
    const items = document.querySelectorAll(messageSelector);

    for (const item of Array.from(items).slice(-maxItems)) {
      try {
        const bodyEl =
          item.querySelector('.msg-s-event__content, .msg-s-event__message, [data-view-name="messaging-message-body"], [data-test-message-text], .break-words, .body') ||
          item;
        const timeEl = item.querySelector('time');
        const senderEl = item.querySelector('.msg-s-message-group__profile-link, .msg-s-event__link');
        const senderNameEl = item.querySelector(
          '.msg-s-message-group__name, .msg-s-message-group__profile-link, .msg-s-event__link, [data-anonymize="person-name"]'
        );
        const isSelf =
          item.classList.contains('msg-s-message-list__event--own-turn') ||
          item.querySelector('[data-view-name="messaging-self-message"]') !== null;

        const text = pickBestMessageText(bodyEl);
        if (!text) continue;

        const rawTimeLabel = normalize(timeEl?.textContent || '');
        const exactDatetime = timeEl?.getAttribute('datetime') || '';
        const createdAt = exactDatetime || parseLooseTimestamp(rawTimeLabel) || '';
        const senderName = isSelf ? '__self__' : normalize(senderNameEl?.textContent) || 'Unknown';
        const msgId = extractStableMessageId(item, bodyEl, timeEl, senderName, text, isSelf);

        results.push({
          id: msgId,
          chatId: currentChatId,
          senderId: isSelf ? '__self__' : senderEl?.href?.match(/\/in\/([^/]+)/)?.[1] || 'other',
          text,
          createdAt,
          senderName,
          isRead: true,
          rawTimeLabel,
          hasExactTimestamp: Boolean(exactDatetime),
        });
      } catch (_) {
        // skip malformed items
      }
    }

    return { participant, items: results };
  }, { maxItems: limit, currentChatId: chatId, messageSelector: THREAD_MESSAGE_SELECTOR });
}

async function scrollThreadHistory(page) {
  return page.evaluate((messageSelector) => {
    const list = document.querySelector('.msg-s-message-list, [data-view-name="messaging-message-list"]');
    const candidateRoots = [
      list,
      list?.parentElement,
      list?.closest?.('.msg-s-message-list-content'),
      list?.closest?.('.msg-s-message-list-container'),
      document.querySelector('.msg-s-message-list-content'),
      document.querySelector('.msg-s-message-list__scrollable-content'),
      document.querySelector('.scaffold-finite-scroll__content'),
      document.querySelector('[data-view-name="messaging-message-list"]'),
    ].filter(Boolean);

    const scrollable = candidateRoots.find((element) => (
      element &&
      typeof element.scrollTop === 'number' &&
      element.scrollHeight - element.clientHeight > 20
    ));

    const visibleCount = document.querySelectorAll(messageSelector).length;

    if (!scrollable) {
      return { found: false, prevTop: 0, nextTop: 0, visibleCount };
    }

    const prevTop = Number(scrollable.scrollTop) || 0;
    const delta = Math.max(Math.round((Number(scrollable.clientHeight) || 0) * 0.9), 500);
    const nextTop = Math.max(0, prevTop - delta);
    scrollable.scrollTop = nextTop;
    scrollable.dispatchEvent(new Event('scroll', { bubbles: true }));

    return { found: true, prevTop, nextTop, visibleCount };
  }, THREAD_MESSAGE_SELECTOR);
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

    let participant = { name: 'Unknown', profileUrl: null };
    let messages = [];
    let previousCollectedCount = 0;
    let stablePasses = 0;

    for (let pass = 1; pass <= 8; pass += 1) {
      const snapshot = await extractThreadSnapshot(page, chatId, limit);
      participant = mergeThreadParticipant(participant, snapshot?.participant);
      messages = mergeThreadSnapshotItems(messages, snapshot?.items || [], limit);

      console.debug(
        `[readThread:${accountId}/${chatId}] pass=${pass} visible=${(snapshot?.items || []).length} collected=${messages.length}`
      );

      if (messages.length >= limit) {
        break;
      }

      const scrollState = await scrollThreadHistory(page);
      if (!scrollState?.found) {
        console.debug(`[readThread:${accountId}/${chatId}] no scrollable thread container found`);
        break;
      }

      if (scrollState.prevTop === scrollState.nextTop || messages.length === previousCollectedCount) {
        stablePasses += 1;
      } else {
        stablePasses = 0;
      }

      previousCollectedCount = messages.length;

      if (stablePasses >= 2) {
        console.debug(
          `[readThread:${accountId}/${chatId}] history growth stabilized after pass=${pass} collected=${messages.length}`
        );
        break;
      }

      await delay(700, 1200);
    }

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
