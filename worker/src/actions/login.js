'use strict';

/**
 * Verifies a session is alive by navigating to LinkedIn feed.
 * Does NOT perform credential login (too CAPTCHA-prone to automate).
 * Cookies must be imported manually via POST /accounts/:id/session.
 *
 * Returns { ok: true } if session is valid, throws WorkerError if not.
 */

const { getAccountContext } = require('../browser');
const { loadCookies, saveCookies }     = require('../session');
const { delay }                        = require('../humanBehavior');

async function verifySession({ accountId, proxyUrl }) {
  const { context } = await getAccountContext(accountId, proxyUrl);
  let page;

  try {
    const cookies = await loadCookies(accountId);
    if (!cookies || cookies.length === 0) {
      const err = new Error(`No session for account ${accountId}. Import cookies first via POST /accounts/${accountId}/session`);
      err.code   = 'NO_SESSION';
      err.status = 401;
      throw err;
    }

    await context.addCookies(cookies);
    page = await context.newPage();

    await page.goto('https://www.linkedin.com/feed/', {
      waitUntil: 'domcontentloaded',
      timeout:   30000,
    });

    await delay(1500, 3000);

    // If redirected to login page, session is expired
    const url = page.url();
    if (url.includes('/login') || url.includes('/checkpoint') || url.includes('/authwall')) {
      const err = new Error(`Session expired for account ${accountId}. Re-import cookies.`);
      err.code   = 'SESSION_EXPIRED';
      err.status = 401;
      throw err;
    }

    // Refresh cookies (LinkedIn rotates them)
    const refreshed = await context.cookies();
    await saveCookies(accountId, refreshed);

    return { ok: true, url };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

module.exports = { verifySession };
