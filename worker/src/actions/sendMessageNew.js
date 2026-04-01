'use strict';

const { getAccountContext }                         = require('../browser');
const { loadCookies, saveCookies }                  = require('../session');
const { delay, humanClick, humanScroll, humanType } = require('../humanBehavior');
const { checkAndIncrement }                         = require('../rateLimit');
const { getRedis }                                  = require('../redisClient');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

async function verifyMessageEcho(page, text, timeoutMs = 12000) {
  const target = normalizeText(text);
  if (!target) return true;

  try {
    await page.waitForFunction(
      (needle) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const candidates = Array.from(
          document.querySelectorAll(
            '.msg-s-message-list__event--own-turn .msg-s-event__content, [data-view-name="messaging-self-message"] .msg-s-event__content, .msg-s-event__content'
          )
        );
        const lastOwn = [...candidates].reverse().find((el) => normalize(el?.textContent));
        if (!lastOwn) return false;
        return normalize(lastOwn.textContent).includes(normalize(needle));
      },
      text,
      { timeout: timeoutMs }
    );
    return true;
  } catch {
    return false;
  }
}

async function sendMessageNew({ accountId, profileUrl, text, proxyUrl }) {
  // W2 — checkAndIncrement moved to AFTER successful send.
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

    // W3 — Try the direct messaging URL first to avoid loading the heavy profile page.
    let participantName = deriveNameFromProfileUrl(profileUrl);
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
              if (nameFromComposer && nameFromComposer !== 'Unknown') {
                participantName = nameFromComposer;
              }
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
        participantName = await page.evaluate((fallbackName) => {
          const messageButton = document.querySelector('button[aria-label*="Message"], a[aria-label*="Message"]');
          const nearestCard   = messageButton?.closest('.pv-top-card, .ph5, .artdeco-card, main, section');
          const scopedName    = nearestCard?.querySelector('h1, [data-anonymize="person-name"], .text-heading-xlarge');
          const fallbackEl    = document.querySelector('h1, [data-anonymize="person-name"], .text-heading-xlarge');
          const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
          const raw = scopedName?.textContent || fallbackEl?.textContent || '';
          return normalize(raw) || fallbackName || 'Unknown';
        }, participantName);
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
    await humanType(page, composeSelector, text, { timeout: 10000 });
    await delay(800, 1800);

    await humanClick(page, '.msg-form__send-button, button[type="submit"][aria-label*="Send"]');
    const verified = await verifyMessageEcho(page, text);
    if (!verified) {
      const err = new Error('Message send could not be confirmed in thread. Retry once with fresh session.');
      err.code = 'SEND_NOT_CONFIRMED';
      err.status = 502;
      throw err;
    }

    // W2 — Burn quota only after the send click succeeds.
    await checkAndIncrement(accountId, 'messagesSent');
    await delay(2000, 4000);

    // Extract new chat ID from URL — LinkedIn redirects to the thread after send
    const finalUrl = page.url();
    let chatId = '';
    const idMatch = finalUrl.match(/\/messaging\/thread\/([^/?]+)/);
    if (idMatch?.[1]) {
      chatId = idMatch[1];
    } else {
      chatId = await page.evaluate(() => {
        const candidates = Array.from(
          document.querySelectorAll(
            'a[href*="/messaging/thread/"], [data-conversation-id], [data-urn*="fs_conversation"]'
          )
        );
        for (const node of candidates) {
          const href = node.getAttribute?.('href') || '';
          const fromHref = href.match(/\/messaging\/thread\/([^/?#]+)/i);
          if (fromHref?.[1]) return fromHref[1];

          const conversationId = node.getAttribute?.('data-conversation-id') || '';
          if (conversationId) return conversationId;

          const urn = node.getAttribute?.('data-urn') || '';
          const urnMatch = urn.match(/fs_conversation:([^,\s)]+)/i);
          if (urnMatch?.[1]) return urnMatch[1];
        }
        return '';
      });
    }

    if (!chatId) {
      chatId = `new-${Date.now()}`;
    }

    if (process.env.REFRESH_SESSION_COOKIES === '1') {
      await saveCookies(accountId, await context.cookies());
    }

    const msgId = `sent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const redis = getRedis();
    const entry = JSON.stringify({
      type: 'messageSent',
      accountId,
      targetName: participantName,
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
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

module.exports = { sendMessageNew };
