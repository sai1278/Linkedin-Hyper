'use strict';

const { getAccountContext, cleanupContext, withAccountLock } = require('../browser');
const { loadCookies, saveCookies }                  = require('../session');
const { delay, humanClick, humanScroll, humanType } = require('../humanBehavior');
const { checkAndIncrement }                         = require('../rateLimit');
const { getRedis }                                  = require('../redisClient');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isGenericUiLabel(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return true;

  if (/^\d+$/.test(normalized)) return true;
  if (/^\d+\s*(notification|notifications|message|messages)(\s+total)?$/.test(normalized)) return true;
  if (/^(notification|notifications|message|messages)\s+total$/.test(normalized)) return true;

  const blocked = new Set([
    'unknown',
    'inbox',
    'messages',
    'activity',
    'notifications',
    'notifications total',
    'loading',
    'linkedin',
    'feed',
    'search',
  ]);
  return blocked.has(normalized);
}

function slugToName(slug) {
  return normalizeText(
    String(slug || '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\d+\b/g, '')
  );
}

function deriveNameFromProfileUrl(profileUrl) {
  const match = String(profileUrl || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match?.[1]) return 'Unknown';
  const name = slugToName(match[1]);
  return name || 'Unknown';
}

function normalizeParticipantName(candidate, profileUrl) {
  const parsed = normalizeText(candidate);
  if (parsed && !isGenericUiLabel(parsed)) {
    return parsed;
  }
  return deriveNameFromProfileUrl(profileUrl);
}

function normalizeThreadIdCandidate(value) {
  return String(value || '').trim();
}

function isValidThreadId(value) {
  const id = normalizeThreadIdCandidate(value);
  if (!id) return false;
  if (id.toLowerCase() === 'new') return false;
  return true;
}

function isRecoverableBrowserError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (!msg) return false;

  return (
    msg.includes('session closed') ||
    msg.includes('frame was detached') ||
    msg.includes('target page, context or browser has been closed') ||
    msg.includes('protocol error (page.createisolatedworld)') ||
    msg.includes('protocol error (page.addscripttoevaluateonnewdocument)') ||
    msg.includes('net::err_aborted')
  );
}

function extractThreadIdFromText(value) {
  const raw = String(value || '');
  if (!raw) return '';

  const fromThreadUrl = raw.match(/\/messaging\/thread\/([^/?#"\s]+)/i);
  if (isValidThreadId(fromThreadUrl?.[1])) return normalizeThreadIdCandidate(fromThreadUrl[1]);

  const fromUrn = raw.match(/fs(?:d)?_conversation:([^,"\s)]+)/i);
  if (isValidThreadId(fromUrn?.[1])) return normalizeThreadIdCandidate(fromUrn[1]);

  const fromQuery = raw.match(/[?&](?:conversationId|threadId)=([^&#"\s]+)/i);
  if (fromQuery?.[1]) {
    try {
      const decoded = decodeURIComponent(fromQuery[1]);
      if (isValidThreadId(decoded)) return normalizeThreadIdCandidate(decoded);
    } catch {
      if (isValidThreadId(fromQuery[1])) return normalizeThreadIdCandidate(fromQuery[1]);
    }
  }

  const fromConversationUrn = raw.match(/conversationUrn=([^&#"\s]+)/i);
  if (fromConversationUrn?.[1]) {
    try {
      const decoded = decodeURIComponent(fromConversationUrn[1]);
      const decodedUrn = decoded.match(/fs(?:d)?_conversation:([^,"\s)]+)/i);
      if (isValidThreadId(decodedUrn?.[1])) return normalizeThreadIdCandidate(decodedUrn[1]);
    } catch {}
  }

  return '';
}

function createNetworkThreadIdProbe(page) {
  let resolvedThreadId = '';
  const pendingParsers = new Set();

  const maybeResolve = (candidate) => {
    if (!resolvedThreadId && isValidThreadId(candidate)) {
      resolvedThreadId = normalizeThreadIdCandidate(candidate);
    }
  };

  const inspectResponse = (response) => {
    if (resolvedThreadId) return;

    try {
      const url = response.url() || '';
      if (!/linkedin\.com/i.test(url) || !/messaging|voyager/i.test(url)) {
        return;
      }

      const idFromUrl = extractThreadIdFromText(url);
      if (idFromUrl) {
        maybeResolve(idFromUrl);
        return;
      }

      const parser = (async () => {
        try {
          const body = await response.text();
          const idFromBody = extractThreadIdFromText(body);
          if (idFromBody) maybeResolve(idFromBody);
        } catch (_) {}
      })();

      pendingParsers.add(parser);
      parser.finally(() => pendingParsers.delete(parser));
    } catch (_) {}
  };

  const inspectRequest = (request) => {
    if (resolvedThreadId) return;
    try {
      const url = request.url() || '';
      if (!/linkedin\.com/i.test(url) || !/messaging|voyager/i.test(url)) {
        return;
      }

      const idFromUrl = extractThreadIdFromText(url);
      if (idFromUrl) {
        maybeResolve(idFromUrl);
        return;
      }

      const postData = request.postData?.() || '';
      const idFromBody = extractThreadIdFromText(postData);
      if (idFromBody) {
        maybeResolve(idFromBody);
      }
    } catch (_) {}
  };

  page.on('request', inspectRequest);
  page.on('response', inspectResponse);

  return {
    async waitForThreadId(waitMs = 12000) {
      const deadline = Date.now() + waitMs;
      while (!resolvedThreadId && Date.now() < deadline) {
        if (pendingParsers.size > 0) {
          await Promise.race([
            Promise.allSettled(Array.from(pendingParsers)),
            delay(180, 260),
          ]);
        } else {
          await delay(180, 260);
        }
      }

      if (!resolvedThreadId && pendingParsers.size > 0) {
        await Promise.allSettled(Array.from(pendingParsers));
      }

      return resolvedThreadId;
    },
    stop() {
      page.off('request', inspectRequest);
      page.off('response', inspectResponse);
    },
  };
}

async function getMessageSnapshot(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const nodes = Array.from(
      document.querySelectorAll(
        [
          '.msg-s-message-list__event--own-turn .msg-s-event__content',
          '[data-view-name="messaging-self-message"] .msg-s-event__content',
          '.msg-s-event-listitem .msg-s-event__content',
          '[data-view-name="messaging-message-list-item"] .msg-s-event__content',
          '.msg-s-event__content',
        ].join(', ')
      )
    );
    const texts = nodes.map((node) => normalize(node?.textContent)).filter(Boolean);
    return {
      count: texts.length,
      lastText: texts.length > 0 ? texts[texts.length - 1] : '',
      recentTexts: texts.slice(-30),
    };
  });
}

async function verifyMessageEcho(page, text, beforeSnapshot, timeoutMs = 12000) {
  const target = normalizeText(text);
  if (!target) return false;
  const beforeCount = Number(beforeSnapshot?.count || 0);
  const beforeLastText = normalizeText(beforeSnapshot?.lastText);
  const beforeRecentTexts = Array.isArray(beforeSnapshot?.recentTexts)
    ? beforeSnapshot.recentTexts.map((item) => normalizeText(item)).filter(Boolean)
    : [];

  try {
    await page.waitForFunction(
      (needle, oldCount, oldLastText, oldRecentTexts) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const nodes = Array.from(
          document.querySelectorAll(
            [
              '.msg-s-message-list__event--own-turn .msg-s-event__content',
              '[data-view-name="messaging-self-message"] .msg-s-event__content',
              '.msg-s-event-listitem .msg-s-event__content',
              '[data-view-name="messaging-message-list-item"] .msg-s-event__content',
              '.msg-s-event__content',
            ].join(', ')
          )
        );
        const texts = nodes.map((node) => normalize(node?.textContent)).filter(Boolean);
        if (texts.length === 0) return false;

        const oldRecent = Array.isArray(oldRecentTexts) ? oldRecentTexts.map((item) => normalize(item)) : [];
        const oldRecentSet = new Set(oldRecent);
        const lastOwnText = normalize(texts[texts.length - 1]);
        const normalizedNeedle = normalize(needle);
        const matchingTexts = texts.filter((item) =>
          item.includes(normalizedNeedle) || normalizedNeedle.includes(item)
        );
        if (matchingTexts.length === 0) return false;

        const hasNewMatchingText = matchingTexts.some((item) => !oldRecentSet.has(item));
        const countIncreased = texts.length > Number(oldCount || 0);
        const changedFromPrevious = lastOwnText !== normalize(oldLastText || '');

        return hasNewMatchingText || countIncreased || changedFromPrevious;
      },
      text,
      beforeCount,
      beforeLastText,
      beforeRecentTexts,
      { timeout: timeoutMs }
    );
    return true;
  } catch {
    return false;
  }
}

async function resolveThreadIdAfterSend(page, waitMs = 9000) {
  const fromUrl = () => {
    const currentUrl = page.url();
    const match = currentUrl.match(/\/messaging\/thread\/([^/?#]+)/i);
    const candidate = match?.[1] || '';
    return isValidThreadId(candidate) ? candidate : '';
  };

  let chatId = fromUrl();
  if (chatId) return chatId;

  try {
    await page.waitForFunction(
      () => /\/messaging\/thread\/(?!new(?:\/|\?|$))[^/?#]+/i.test(window.location.pathname + window.location.search),
      { timeout: waitMs }
    );
    chatId = fromUrl();
    if (chatId) return chatId;
  } catch (_) {}

  try {
    chatId = await page.evaluate(() => {
      const normalizeThreadId = (value) => String(value || '').trim();
      const isValidThreadId = (value) => {
        const id = normalizeThreadId(value);
        if (!id) return false;
        if (id.toLowerCase() === 'new') return false;
        return true;
      };
      const idFromHref = (href) => {
        const fromHref = String(href || '').match(/\/messaging\/thread\/([^/?#]+)/i);
        const candidate = fromHref?.[1] || '';
        return isValidThreadId(candidate) ? candidate : '';
      };

      const candidates = Array.from(
        document.querySelectorAll(
          'a[href*="/messaging/thread/"], [data-conversation-id], [data-urn*="fs_conversation"]'
        )
      );
      for (const node of candidates) {
        const href = node.getAttribute?.('href') || '';
        const idFromLink = idFromHref(href);
        if (idFromLink) return idFromLink;

        const conversationId = node.getAttribute?.('data-conversation-id') || '';
        if (isValidThreadId(conversationId)) return normalizeThreadId(conversationId);

        const urn = node.getAttribute?.('data-urn') || '';
        const urnMatch = urn.match(/fs_conversation:([^,\s)]+)/i);
        if (isValidThreadId(urnMatch?.[1])) return normalizeThreadId(urnMatch[1]);
      }

      const params = new URLSearchParams(window.location.search || '');
      const explicitThreadId = params.get('threadId') || params.get('conversationId');
      if (isValidThreadId(explicitThreadId)) return normalizeThreadId(explicitThreadId);

      const conversationUrn = params.get('conversationUrn') || '';
      const urnIdMatch = conversationUrn.match(/fs_conversation:([^,\s)]+)/i);
      if (isValidThreadId(urnIdMatch?.[1])) return normalizeThreadId(urnIdMatch[1]);

      const resources = performance.getEntriesByType('resource') || [];
      for (let i = resources.length - 1; i >= 0; i -= 1) {
        const resourceUrl = String(resources[i]?.name || '');
        const fromMessagingApi = resourceUrl.match(/messaging\/conversations\/([^/?#]+)/i);
        if (isValidThreadId(fromMessagingApi?.[1])) return normalizeThreadId(fromMessagingApi[1]);
      }
      return '';
    });
  } catch (_) {
    chatId = '';
  }

  return isValidThreadId(chatId) ? chatId : '';
}

async function resolveThreadIdFromConversationPreview(page, messageText, waitMs = 12000) {
  const target = normalizeText(messageText);
  if (!target) return '';
  const excerpt = target.slice(0, 48).toLowerCase();
  const deadline = Date.now() + waitMs;

  while (Date.now() < deadline) {
    try {
      const chatId = await page.evaluate((needle) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isValidThreadId = (value) => {
          const id = String(value || '').trim();
          if (!id) return false;
          if (id.toLowerCase() === 'new') return false;
          return true;
        };

        const anchors = Array.from(document.querySelectorAll('a[href*="/messaging/thread/"]'));
        for (const anchor of anchors) {
          const href = anchor.getAttribute?.('href') || '';
          const match = href.match(/\/messaging\/thread\/([^/?#]+)/i);
          const candidateId = match?.[1] || '';
          if (!isValidThreadId(candidateId)) continue;

          const row =
            anchor.closest('.msg-conversation-listitem, .msg-conversation-card, li, [data-view-name*="conversation"]') ||
            anchor;
          const rowText = normalize(row?.textContent).toLowerCase();
          if (rowText.includes(needle)) {
            return String(candidateId).trim();
          }
        }
        return '';
      }, excerpt);

      if (isValidThreadId(chatId)) {
        return chatId;
      }
    } catch (_) {}

    await delay(600, 900);
  }

  return '';
}

async function resolveThreadIdFromMessagingHome(page, { profileUrl, participantName, messageText }, waitMs = 15000) {
  const targetSlug = String(profileUrl || '').match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1] || '';
  const slugNeedle = slugToName(targetSlug).toLowerCase();
  const nameNeedle = normalizeText(participantName).toLowerCase();
  const textNeedle = normalizeText(messageText).slice(0, 48).toLowerCase();
  const tokenNeedles = Array.from(new Set(
    `${slugNeedle} ${nameNeedle}`
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  ));

  try {
    await page.goto('https://www.linkedin.com/messaging/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
  } catch (_) {
    return '';
  }

  await page.waitForSelector('a[href*="/messaging/thread/"], .msg-conversation-listitem', {
    timeout: 12000,
  }).catch(() => null);

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    try {
      const chatId = await page.evaluate((slugNeedleInput, nameNeedleInput, textNeedleInput, tokenNeedlesInput) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isValidThreadId = (value) => {
          const id = String(value || '').trim();
          if (!id) return false;
          if (id.toLowerCase() === 'new') return false;
          return true;
        };

        const candidates = Array.from(document.querySelectorAll('a[href*="/messaging/thread/"]'));
        let bestMatch = { id: '', score: -1 };

        for (const anchor of candidates) {
          const href = anchor.getAttribute?.('href') || '';
          const match = href.match(/\/messaging\/thread\/([^/?#]+)/i);
          const candidateId = match?.[1] || '';
          if (!isValidThreadId(candidateId)) continue;

          const row =
            anchor.closest('.msg-conversation-listitem, .msg-conversation-card, li, [data-view-name*="conversation"]') ||
            anchor;
          const rowText = normalize(row?.textContent).toLowerCase();
          if (!rowText) continue;

          let score = 0;
          if (textNeedleInput && rowText.includes(textNeedleInput)) score += 5;
          if (nameNeedleInput && rowText.includes(nameNeedleInput)) score += 3;
          if (slugNeedleInput && rowText.includes(slugNeedleInput)) score += 2;
          if (Array.isArray(tokenNeedlesInput)) {
            let tokenHits = 0;
            for (const token of tokenNeedlesInput) {
              if (token && rowText.includes(String(token).toLowerCase())) {
                tokenHits += 1;
              }
            }
            score += Math.min(4, tokenHits);
          }

          if (score > bestMatch.score) {
            bestMatch = { id: String(candidateId).trim(), score };
          }
        }

        return bestMatch.score >= 2 ? bestMatch.id : '';
      }, slugNeedle, nameNeedle, textNeedle, tokenNeedles);

      if (isValidThreadId(chatId)) {
        return chatId;
      }
    } catch (_) {}

    await delay(600, 900);
  }

  return '';
}

async function confirmMessagePersistedInThread(page, chatId, text, timeoutMs = 15000) {
  const normalizedChatId = String(chatId || '').trim();
  const target = normalizeText(text);
  if (!normalizedChatId || !target) return false;

  try {
    await page.goto(`https://www.linkedin.com/messaging/thread/${normalizedChatId}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
  } catch (_) {
    // Continue and try selector-based confirmation from current DOM.
  }

  const waitForPersistedText = async (waitMs) => {
    try {
      await page.waitForFunction(
        (needle) => {
          const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
          const targetText = normalize(needle);
          if (!targetText) return false;

          const nodes = Array.from(
            document.querySelectorAll(
              [
                '.msg-s-message-list__event--own-turn .msg-s-event__content',
                '[data-view-name="messaging-self-message"] .msg-s-event__content',
                '.msg-s-event-listitem .msg-s-event__content',
                '.msg-s-event-listitem .msg-s-event-listitem__body',
                '[data-view-name="messaging-message-list-item"] .msg-s-event__content',
                '[data-view-name="messaging-message-list-item"] .msg-s-event-listitem__body',
                '[data-view-name="messaging-message-list-item"] [dir]',
                '.msg-s-event__content',
                '[data-test-message-content]',
              ].join(', ')
            )
          );

          const hasDirectMatch = nodes.some((node) => {
            const value = normalize(node?.textContent);
            return value && (value.includes(targetText) || targetText.includes(value));
          });
          if (hasDirectMatch) return true;

          const rowNodes = Array.from(
            document.querySelectorAll('.msg-s-event-listitem, [data-view-name="messaging-message-list-item"]')
          );
          const hasRowMatch = rowNodes.some((row) => {
            const value = normalize(row?.textContent);
            return value && (value.includes(targetText) || targetText.includes(value));
          });
          if (hasRowMatch) return true;

          const listContainer = document.querySelector('.msg-s-message-list, [data-view-name="messaging-message-list"]');
          const listText = normalize(listContainer?.textContent);
          return Boolean(listText && (listText.includes(targetText) || targetText.includes(listText)));
        },
        text,
        { timeout: waitMs }
      );
      return true;
    } catch {
      return false;
    }
  };

  await page.waitForSelector('.msg-s-message-list, [data-view-name="messaging-message-list"]', {
    timeout: 8000,
  }).catch(() => null);

  if (await waitForPersistedText(timeoutMs)) {
    return true;
  }

  // One reload pass for slower LinkedIn thread hydration.
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (_) {}

  await page.waitForSelector('.msg-s-message-list, [data-view-name="messaging-message-list"]', {
    timeout: 8000,
  }).catch(() => null);

  return waitForPersistedText(Math.max(8000, Math.floor(timeoutMs / 2)));
}

async function sendMessageNewInternal({ accountId, profileUrl, text, proxyUrl, __attempt = 1 }) {
  // W2 — checkAndIncrement moved to AFTER successful send.
  await cleanupContext(accountId).catch(() => {});
  const { context, cookiesLoaded } = await getAccountContext(accountId, proxyUrl);
  let page;
  let networkThreadProbe = null;

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

    // W3 — Try the direct messaging URL first to avoid loading the heavy profile page.
    let participantName = normalizeParticipantName('', profileUrl);
    const memberIdMatch = profileUrl.match(/\/in\/([^/?#]+)/);
    const directUrl = memberIdMatch
      ? `https://www.linkedin.com/messaging/thread/new/?recipient=${memberIdMatch[1]}`
      : null;

    let usedDirectUrl = false;
    if (directUrl) {
      try {
        await page.goto(directUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const directUrlLanding = page.url();
        if (!directUrlLanding.includes('/login') && !directUrlLanding.includes('/checkpoint') && !directUrlLanding.includes('/authwall')) {
          const composeBox = await page
            .waitForSelector('.msg-form__contenteditable, [contenteditable][role="textbox"]', { timeout: 8000 })
            .catch(() => null);
          usedDirectUrl = !!composeBox;

          if (usedDirectUrl) {
            try {
              const nameFromComposer = await page.evaluate(() => {
                const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
                const nameEl = document.querySelector(
                  '.msg-thread__name, .msg-entity-lockup__entity-title, [data-anonymize="person-name"], h1, h2'
                );
                return normalize(nameEl?.textContent);
              });
              participantName = normalizeParticipantName(nameFromComposer, profileUrl);
            } catch (_) {}
          }
        }
      } catch (_) {
        // Fall back to profile-page flow below.
        usedDirectUrl = false;
      }
    }

    if (!usedDirectUrl) {
      // Fallback: navigate to recipient's profile page and click "Message"
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const landingUrl = page.url();
      if (landingUrl.includes('/login') || landingUrl.includes('/checkpoint') || landingUrl.includes('/authwall')) {
        const err = new Error(`Session expired for account ${accountId}. Re-import cookies.`);
        err.code = 'SESSION_EXPIRED'; err.status = 401;
        throw err;
      }
      await delay(2500, 5000); // simulate reading the profile

      await humanScroll(page, 200);
      await delay(800, 1500);

      // Extract profile name near the Message button
      try {
        const candidateName = await page.evaluate((fallbackName) => {
          const messageButton = document.querySelector('button[aria-label*="Message"], a[aria-label*="Message"]');
          const nearestCard   = messageButton?.closest('.pv-top-card, .ph5, .artdeco-card, main, section');
          const scopedName    = nearestCard?.querySelector('h1, [data-anonymize="person-name"], .text-heading-xlarge');
          const fallbackEl    = document.querySelector('h1, [data-anonymize="person-name"], .text-heading-xlarge');
          const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
          const raw = scopedName?.textContent || fallbackEl?.textContent || '';
          return normalize(raw) || fallbackName || 'Unknown';
        }, participantName);
        participantName = normalizeParticipantName(candidateName, profileUrl);
      } catch (_) {}

      try {
        await humanClick(page, 'button[aria-label*="Message"], a[aria-label*="Message"]', { timeout: 10000 });
      } catch (_) {
        const err = new Error('Could not open message composer from profile. Ensure target profile is messageable and you are connected.');
        err.code = 'NOT_MESSAGEABLE';
        err.status = 400;
        throw err;
      }
      await delay(1500, 3000);
    }

    const composeSelector = '.msg-form__contenteditable, [contenteditable][role="textbox"]';
    const beforeSnapshot = await getMessageSnapshot(page).catch(() => ({ count: 0, lastText: '', recentTexts: [] }));
    await humanType(page, composeSelector, text, { timeout: 10000 });
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

    // W2 — Burn quota only after the send click succeeds.
    let chatId = await resolveThreadIdAfterSend(page, 12000);
    if (!chatId) {
      chatId = await networkThreadProbe.waitForThreadId(12000);
    }
    if (!chatId) {
      chatId = await resolveThreadIdFromConversationPreview(page, text, 12000);
    }
    if (!chatId) {
      chatId = await resolveThreadIdFromMessagingHome(
        page,
        { profileUrl, participantName, messageText: text },
        20000
      );
    }
    if (!chatId) {
      const err = new Error('Send clicked but LinkedIn thread ID was not resolved. Message may not be delivered.');
      err.code = 'SEND_NOT_CONFIRMED';
      err.status = 502;
      throw err;
    }

    const persisted = await confirmMessagePersistedInThread(page, chatId, text, 30000);
    if (!persisted) {
      const err = new Error('Message was not found in thread after send confirmation. Message may not be delivered.');
      err.code = 'SEND_NOT_CONFIRMED';
      err.status = 502;
      throw err;
    }

    await checkAndIncrement(accountId, 'messagesSent');
    await delay(2000, 4000);

    if (process.env.REFRESH_SESSION_COOKIES === '1') {
      await saveCookies(accountId, await context.cookies());
    }

    const msgId = `sent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const redis = getRedis();
    const entry = JSON.stringify({
      type: 'messageSent',
      accountId,
      targetName: normalizeParticipantName(participantName, profileUrl),
      targetProfileUrl: profileUrl, // correct: real profile URL
      textPreview: (text || '').slice(0, 200),
      messageLength: text ? text.length : 0,
      timestamp: Date.now(),
    });
    await redis.lpush(`activity:log:${accountId}`, entry);
    await redis.ltrim(`activity:log:${accountId}`, 0, 999);
    await redis.incr(`stats:messages:${accountId}`);

    return {
      id:        msgId,
      chatId,
      senderId:  '__self__',
      text,
      createdAt: new Date().toISOString(),
      isRead:    true,
    };
  } catch (err) {
    if (__attempt < 2 && isRecoverableBrowserError(err)) {
      await cleanupContext(accountId).catch(() => {});
      await delay(700, 1300);
      return sendMessageNewInternal({ accountId, profileUrl, text, proxyUrl, __attempt: __attempt + 1 });
    }
    throw err;
  } finally {
    if (networkThreadProbe) {
      networkThreadProbe.stop();
    }
    if (page) await page.close().catch(() => {});
  }
}

async function sendMessageNew({ accountId, profileUrl, text, proxyUrl }) {
  return withAccountLock(accountId, async () =>
    sendMessageNewInternal({ accountId, profileUrl, text, proxyUrl, __attempt: 1 })
  );
}

module.exports = { sendMessageNew };
