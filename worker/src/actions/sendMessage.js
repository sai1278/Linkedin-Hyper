'use strict';

const { getAccountContext } = require('../browser');
const { loadCookies, saveCookies } = require('../session');
const { delay, humanClick, humanType } = require('../humanBehavior');
const { checkAndIncrement } = require('../rateLimit');
const { getRedis } = require('../redisClient');

async function verifyMessageEcho(page, text, timeoutMs = 12000) {
  const target = String(text || '').replace(/\s+/g, ' ').trim();
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

async function sendMessage({ accountId, chatId, text, proxyUrl }) {
  const { context, cookiesLoaded } = await getAccountContext(accountId, proxyUrl);
  let page;

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

    const normalizedChatId = String(chatId || '').replace(new RegExp(`^${accountId}:`), '');

    await page.goto(`https://www.linkedin.com/messaging/thread/${normalizedChatId}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await delay(2000, 4000);

    await page
      .waitForSelector(
        '.msg-form__contenteditable, [data-view-name="messaging-compose-box"] [contenteditable]',
        { timeout: 10000 }
      )
      .catch(() => null);

    await humanType(
      page,
      '.msg-form__contenteditable, [data-view-name="messaging-compose-box"] [contenteditable]',
      text
    );
    await delay(800, 1800);

    await humanClick(page, '.msg-form__send-button, button[type="submit"][aria-label*="Send"]');
    await delay(1200, 2200);

    const verified = await verifyMessageEcho(page, text);
    if (!verified) {
      const err = new Error('Message send could not be confirmed in thread. Retry once with fresh session.');
      err.code = 'SEND_NOT_CONFIRMED';
      err.status = 502;
      throw err;
    }

    await checkAndIncrement(accountId, 'messagesSent');
    await delay(500, 1200);

    if (process.env.REFRESH_SESSION_COOKIES === '1') {
      await saveCookies(accountId, await context.cookies());
    }

    const msgId = `sent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    let participantName = 'Unknown';
    let profileUrl = null;
    try {
      const nameEl = await page.$('.msg-thread__name, .msg-entity-lockup__entity-title');
      if (nameEl) {
        const nameText = await nameEl.textContent();
        if (nameText) participantName = nameText.trim();

        const linkEl = await page.$(
          '.msg-entity-lockup__entity-title-container a[href*="/in/"], .msg-thread__link[href*="/in/"]'
        );
        if (linkEl) {
          const href = await linkEl.getAttribute('href');
          if (href) profileUrl = new URL(href, 'https://www.linkedin.com').href;
        }
      }
    } catch (_) {}

    const redis = getRedis();
    const entry = JSON.stringify({
      type: 'messageSent',
      accountId,
      targetName: participantName,
      targetProfileUrl: profileUrl || '',
      textPreview: (text || '').slice(0, 200),
      messageLength: text ? text.length : 0,
      timestamp: Date.now(),
    });
    await redis.lpush(`activity:log:${accountId}`, entry);
    await redis.ltrim(`activity:log:${accountId}`, 0, 999);
    await redis.incr(`stats:messages:${accountId}`);

    return {
      id: msgId,
      chatId: normalizedChatId,
      senderId: '__self__',
      text,
      createdAt: new Date().toISOString(),
      isRead: true,
    };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

module.exports = { sendMessage };
