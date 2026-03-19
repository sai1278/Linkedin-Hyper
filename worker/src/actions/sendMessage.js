'use strict';

const { getAccountContext }            = require('../browser');
const { loadCookies, saveCookies }     = require('../session');
const { delay, humanClick, humanType } = require('../humanBehavior');
const { checkAndIncrement }            = require('../rateLimit');
const { getRedis }                     = require('../redisClient');

async function sendMessage({ accountId, chatId, text, proxyUrl }) {
  // W2 — checkAndIncrement moved to AFTER successful send; quota isn't burned
  // if the browser crashes, a selector fails, or LinkedIn rejects the message.
  const { context, cookiesLoaded } = await getAccountContext(accountId, proxyUrl);
  let page;

  try {
    // W1 — Only load + inject cookies on a cache miss (new browser context).
    // On cache hits the context already has up-to-date cookies from the previous
    // job's saveCookies() call — skips a Redis GET + Playwright IPC round-trip.
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

    await delay(2000, 4000);

    await page.waitForSelector(
      '.msg-form__contenteditable, [data-view-name="messaging-compose-box"] [contenteditable]',
      { timeout: 10000 }
    ).catch(() => null);

    await humanType(page, '.msg-form__contenteditable, [data-view-name="messaging-compose-box"] [contenteditable]', text);
    await delay(800, 1800);

    await humanClick(page, '.msg-form__send-button, button[type="submit"][aria-label*="Send"]');
    // W2 — Increment AFTER the click that commits the send.
    await checkAndIncrement(accountId, 'messagesSent');
    await delay(1500, 3000);

    await saveCookies(accountId, await context.cookies());

    const msgId = `sent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Try to extract real participant name from thread header
    let participantName = 'Unknown';
    let profileUrl = null;
    try {
      const nameEl = await page.$('.msg-thread__name, .msg-entity-lockup__entity-title');
      if (nameEl) {
        const nameText = await nameEl.textContent();
        if (nameText) participantName = nameText.trim();
        
        // Try to get profile URL from parent link or nearby link
        const linkEl = await page.$('.msg-entity-lockup__entity-title-container a, .msg-thread__link');
        if (linkEl) {
          const href = await linkEl.getAttribute('href');
          if (href) profileUrl = new URL(href, 'https://www.linkedin.com').href;
        }
      }
    } catch (_) {}

    // Log activity — targetProfileUrl is now correctly parsed or empty string
    const redis = getRedis();
    const entry = JSON.stringify({
      type: 'messageSent',
      accountId,
      targetName: participantName,
      targetProfileUrl: profileUrl || '',
      message: text,
      timestamp: Date.now(),
    });
    await redis.lpush(`activity:log:${accountId}`, entry);
    await redis.ltrim(`activity:log:${accountId}`, 0, 999); // cap at 1000 entries
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

module.exports = { sendMessage };
