'use strict';

const { getAccountContext }        = require('../browser');
const { loadCookies, saveCookies } = require('../session');
const { delay }                    = require('../humanBehavior');

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

    const url = page.url();
    if (url.includes('/login') || url.includes('/checkpoint') || url.includes('/authwall')) {
      const err = new Error(`Session expired for account ${accountId}. Re-import cookies.`);
      err.code   = 'SESSION_EXPIRED';
      err.status = 401;
      throw err;
    }

    // LinkedIn rotates cookies — always save refreshed ones
    await saveCookies(accountId, await context.cookies());

    return { ok: true, url };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

module.exports = { verifySession };
