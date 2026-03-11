'use strict';

/**
 * Navigates to a LinkedIn profile and sends a new message via the Message button.
 * Returns the message object including the chat ID extracted from the URL.
 */

const { createBrowser, createContext }   = require('../browser');
const { loadCookies, saveCookies }       = require('../session');
const { delay, humanClick, humanScroll } = require('../humanBehavior');
const { checkAndIncrement }              = require('../rateLimit');

async function sendMessageNew({ accountId, profileUrl, text, proxyUrl }) {
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

    // Navigate to the recipient's profile (more natural than going to messaging directly)
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2500, 5000); // Simulate reading the profile

    await humanScroll(page, 200);
    await delay(800, 1500);

    // Click the Message button on their profile
    await humanClick(page, 'button[aria-label*="Message"], a[aria-label*="Message"]', { timeout: 10000 });
    await delay(1500, 3000);

    // Type the message in the compose modal
    const composeSelector = '.msg-form__contenteditable, [contenteditable][role="textbox"]';
    await page.waitForSelector(composeSelector, { timeout: 10000 });
    await page.keyboard.type(text, { delay: 65 + Math.random() * 85 });
    await delay(800, 1800);

    // Send
    await humanClick(page, '.msg-form__send-button, button[type="submit"][aria-label*="Send"]');
    await delay(2000, 4000);

    // Extract new chat ID from URL if we were redirected to the thread
    const finalUrl = page.url();
    const idMatch  = finalUrl.match(/\/messaging\/thread\/([^/?]+)/);
    const chatId   = idMatch ? idMatch[1] : `new-${Date.now()}`;

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

module.exports = { sendMessageNew };
