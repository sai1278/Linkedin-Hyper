'use strict';

/**
 * Sends a message in an existing LinkedIn conversation thread.
 */

const { getAccountContext }            = require('../browser');
const { loadCookies, saveCookies }     = require('../session');
const { delay, humanClick, humanType } = require('../humanBehavior');
const { checkAndIncrement }            = require('../rateLimit');
const { getRedis }                     = require('../redisClient');

async function sendMessage({ accountId, chatId, text, proxyUrl }) {
  await checkAndIncrement(accountId, 'messagesSent');

  const { context } = await getAccountContext(accountId, proxyUrl);
  let page;

  try {
    const cookies = await loadCookies(accountId);
    if (!cookies) {
      const err = new Error(`No session for account ${accountId}`);
      err.code = 'NO_SESSION'; err.status = 401;
      throw err;
    }

    await context.addCookies(cookies);
    page = await context.newPage();

    await page.goto(`https://www.linkedin.com/messaging/thread/${chatId}/`, {
      waitUntil: 'domcontentloaded',
      timeout:   30000,
    });

    await delay(2000, 4000);

    // Type the message
    await humanType(page, '.msg-form__contenteditable, [data-view-name="messaging-compose-box"] [contenteditable]', text);
    await delay(800, 1800);

    // Send
    await humanClick(page, '.msg-form__send-button, button[type="submit"][aria-label*="Send"]');
    await delay(1500, 3000);

    await saveCookies(accountId, await context.cookies());

    const msgId = `sent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    
    // Try to extract the real participant name
    let participantName = 'Unknown';
    try {
      const nameEl = await page.$('.msg-thread__name, .msg-entity-lockup__entity-title');
      if (nameEl) {
        const text = await nameEl.textContent();
        if (text) participantName = text.trim();
      }
    } catch (_) {}

    const redis = getRedis();
    const entry = JSON.stringify({
      type: 'messageSent',
      accountId,
      targetName: participantName,
      targetProfileUrl: chatId,
      message: text,
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

module.exports = { sendMessage };
