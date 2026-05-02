'use strict';

const { getAccountContext, cleanupContext, withAccountLock } = require('../browser');
const { loadCookies, saveCookies } = require('../session');
const { delay, humanScroll } = require('../humanBehavior');
const { checkAndIncrement } = require('../rateLimit');

function isAuthLandingUrl(url) {
  const value = String(url || '').toLowerCase();
  return (
    value.includes('/login') ||
    value.includes('/checkpoint') ||
    value.includes('/authwall') ||
    value.includes('/challenge')
  );
}

function isRecoverableBrowserError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (!msg) return false;

  return (
    msg.includes('session closed') ||
    msg.includes('target page, context or browser has been closed') ||
    msg.includes('frame was detached') ||
    msg.includes('net::err_aborted') ||
    msg.includes('protocol error (page.addscripttoevaluateonnewdocument)') ||
    msg.includes('protocol error (page.createisolatedworld)') ||
    msg.includes('operation failed')
  );
}

async function searchPeopleInternal({
  accountId,
  query,
  proxyUrl,
  limit = 10,
  __attempt = 1,
  forceCookieReload = false,
}) {
  const { context, cookiesLoaded } = await getAccountContext(accountId, proxyUrl);
  let page;

  try {
    if (!cookiesLoaded || forceCookieReload) {
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

    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}&origin=GLOBAL_SEARCH_HEADER`;
    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (navErr) {
      const msg = navErr instanceof Error ? navErr.message : String(navErr);
      if (msg.includes('ERR_TOO_MANY_REDIRECTS')) {
        const err = new Error(`Session expired for account ${accountId}. Re-import cookies.`);
        err.code = 'SESSION_EXPIRED';
        err.status = 401;
        throw err;
      }
      throw navErr;
    }

    const landingUrl = page.url();
    if (isAuthLandingUrl(landingUrl)) {
      if (__attempt < 2 && cookiesLoaded && !forceCookieReload) {
        await cleanupContext(accountId).catch(() => {});
        await delay(250, 500);
        return searchPeopleInternal({
          accountId,
          query,
          proxyUrl,
          limit,
          __attempt: __attempt + 1,
          forceCookieReload: true,
        });
      }

      const err = new Error(`Session expired for account ${accountId}. Re-import cookies.`);
      err.code = 'SESSION_EXPIRED';
      err.status = 401;
      throw err;
    }

    await delay(2000, 4000);

    await page
      .waitForSelector('.reusable-search__result-container, .search-results-container', {
        timeout: 12000,
      })
      .catch(() => null);

    await humanScroll(page, 400);
    await delay(800, 1500);

    const profiles = await page.evaluate((maxItems) => {
      const results = [];
      const cards = document.querySelectorAll('.reusable-search__result-container li, .entity-result');

      for (const card of Array.from(cards).slice(0, maxItems)) {
        try {
          const nameEl = card.querySelector('.entity-result__title-text a span[aria-hidden], .actor-name');
          const headlineEl = card.querySelector('.entity-result__primary-subtitle');
          const locationEl = card.querySelector('.entity-result__secondary-subtitle');
          const avatarEl = card.querySelector('img.presence-entity__image, img.evi-image');
          const linkEl = card.querySelector('a[href*="/in/"]');
          const href = linkEl?.href || '';
          const profileId = href.match(/\/in\/([^/?]+)/)?.[1] || `unknown-${Date.now()}`;

          if (!nameEl) continue;

          results.push({
            id: profileId,
            name: nameEl.textContent?.trim() || 'Unknown',
            headline: headlineEl?.textContent?.trim() || null,
            location: locationEl?.textContent?.trim() || null,
            avatarUrl: avatarEl?.src || null,
            profileUrl: href || null,
            company: null,
          });
        } catch (_) {
          // skip malformed cards
        }
      }

      return results;
    }, limit);

    if (process.env.REFRESH_SESSION_COOKIES === '1') {
      await saveCookies(accountId, await context.cookies(), {
        skipIfMissingAuthCookies: true,
        source: 'searchPeople',
      });
    }

    return profiles;
  } catch (err) {
    if (__attempt < 2 && isRecoverableBrowserError(err)) {
      await cleanupContext(accountId).catch(() => {});
      await delay(250, 500);
      return searchPeopleInternal({
        accountId,
        query,
        proxyUrl,
        limit,
        __attempt: __attempt + 1,
        forceCookieReload: true,
      });
    }
    throw err;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

async function searchPeople({ accountId, query, proxyUrl, limit = 10 }) {
  return withAccountLock(accountId, async () => {
    await checkAndIncrement(accountId, 'searchQueries');
    return searchPeopleInternal({
      accountId,
      query,
      proxyUrl,
      limit,
      __attempt: 1,
      forceCookieReload: false,
    });
  });
}

module.exports = { searchPeople };
