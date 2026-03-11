'use strict';

/**
 * Sends a message in an existing LinkedIn conversation thread.
 */

const { createBrowser, createContext } = require('../browser');
const { loadCookies, saveCookies }     = require('../session');
const { delay, humanClick }            = require('../humanBehavior');
const { checkAndIncrement }            = require('../rateLimit');

async function sendMessage({ accountId, chatId, text, proxyUrl }) {
  await checkAndIncrement(accountId, 'messagesSent');

  const browser = await createBrowser(proxyUrl);
  const context = await createContext(browser);

  try {
    const cookies = await loadCookies(accountId);
    if (!cookies) {
      const err = new Error(`No session for account ${accountId}`);
      err.code = 'NO_SESSION'; err.status = 401;
      throw err;
    }

    await context.addCookies(cookies);
    const page = await context.newPage();

    await page.goto(`https://www.linkedin.com/messaging/thread/${chatId}/`, {
      waitUntil: 'domcontentloaded',
      timeout:   30000,
    });

    await delay(2000, 4000);

    // Click the message compose box
    await humanClick(page, '.msg-form__contenteditable, [data-view-name="messaging-compose-box"] [contenteditable]');
    await delay(500, 1000);

    // Type the message
    await page.keyboard.type(text, { delay: 60 + Math.random() * 80 });
    await delay(800, 1800);

    // Send
    await humanClick(page, '.msg-form__send-button, button[type="submit"][aria-label*="Send"]');
    await delay(1500, 3000);

    await saveCookies(accountId, await context.cookies());

    const msgId = `sent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return {
      id:        msgId,
      chatId,
      senderId:  '__self__',
      text,
      createdAt: new Date().toISOString(),
      isRead:    true,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = { sendMessage };
