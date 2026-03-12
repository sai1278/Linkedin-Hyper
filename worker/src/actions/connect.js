'use strict';

/**
 * Sends a LinkedIn connection request to a profile.
 * Optionally includes a personalised note (max 300 chars).
 */

const { getAccountContext }                         = require('../browser');
const { loadCookies, saveCookies }                  = require('../session');
const { delay, humanClick, humanType, humanScroll } = require('../humanBehavior');
const { checkAndIncrement }                         = require('../rateLimit');
const { getRedis }                                  = require('../redisClient');

async function sendConnectionRequest({ accountId, profileUrl, note, proxyUrl }) {
  await checkAndIncrement(accountId, 'connectRequests');

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

    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2500, 5000);

    await humanScroll(page, 150);
    await delay(800, 1500);

    // Click Connect button — may be inside a More dropdown
    const connectBtn = await page.$('button[aria-label*="Connect"], button[aria-label*="connect"]');

    if (!connectBtn) {
      // Try via the More... actions dropdown
      await humanClick(page, 'button[aria-label*="More actions"]', { timeout: 8000 });
      await delay(500, 1000);
      await humanClick(page, '[aria-label*="Connect"]', { timeout: 5000 });
    } else {
      await humanClick(page, 'button[aria-label*="Connect"]');
    }

    await delay(1000, 2000);

    if (note && note.trim().length > 0) {
      // Click "Add a note" in the connection modal
      const addNoteBtn = await page.$('button[aria-label*="Add a note"]');
      if (addNoteBtn) {
        await humanClick(page, 'button[aria-label*="Add a note"]');
        await delay(500, 1000);
        await humanType(page, '#custom-message, textarea[name="message"]', note.slice(0, 300));
        await delay(600, 1200);
      }
    }

    // Click Send / Done
    await humanClick(page, 'button[aria-label*="Send invitation"], button[aria-label*="Send now"]');
    await delay(1500, 3000);

    await saveCookies(accountId, await context.cookies());

    // Log activity
    const redis = getRedis();
    const entry = JSON.stringify({
      type: 'connectionSent',
      accountId,
      targetName: 'Participant',
      targetProfileUrl: profileUrl,
      message: note || '',
      timestamp: Date.now(),
    });
    await redis.lpush(`activity:log:${accountId}`, entry);
    await redis.ltrim(`activity:log:${accountId}`, 0, 999);

    return { success: true, profileUrl };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

module.exports = { sendConnectionRequest };
