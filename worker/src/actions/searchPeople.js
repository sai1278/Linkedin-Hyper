'use strict';

/**
 * Searches LinkedIn for people matching a query string.
 * Returns a list of WorkerProfile objects.
 */

const { createBrowser, createContext } = require('../browser');
const { loadCookies, saveCookies }     = require('../session');
const { delay, humanScroll }           = require('../humanBehavior');
const { checkAndIncrement }            = require('../rateLimit');

async function searchPeople({ accountId, query, proxyUrl, limit = 10 }) {
  await checkAndIncrement(accountId, 'searchQueries');

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

    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}&origin=GLOBAL_SEARCH_HEADER`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2000, 4000);

    await page.waitForSelector('.reusable-search__result-container, .search-results-container', {
      timeout: 12000,
    }).catch(() => null);

    await humanScroll(page, 400);
    await delay(800, 1500);

    const profiles = await page.evaluate((maxItems) => {
      const results = [];
      const cards   = document.querySelectorAll(
        '.reusable-search__result-container li, .entity-result'
      );

      for (const card of Array.from(cards).slice(0, maxItems)) {
        try {
          const nameEl     = card.querySelector('.entity-result__title-text a span[aria-hidden], .actor-name');
          const headlineEl = card.querySelector('.entity-result__primary-subtitle');
          const locationEl = card.querySelector('.entity-result__secondary-subtitle');
          const avatarEl   = card.querySelector('img.presence-entity__image, img.evi-image');
          const linkEl     = card.querySelector('a[href*="/in/"]');
          const href       = linkEl?.href || '';
          const profileId  = href.match(/\/in\/([^/?]+)/)?.[1] || `unknown-${Date.now()}`;

          if (!nameEl) continue;

          results.push({
            id:         profileId,
            name:       nameEl.textContent?.trim()      || 'Unknown',
            headline:   headlineEl?.textContent?.trim() || null,
            location:   locationEl?.textContent?.trim() || null,
            avatarUrl:  avatarEl?.src                   || null,
            profileUrl: href                            || null,
            company:    null,
          });
        } catch (_) { /* skip */ }
      }
      return results;
    }, limit);

    await saveCookies(accountId, await context.cookies());

    return profiles;
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = { searchPeople };
