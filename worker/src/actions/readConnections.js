'use strict';

const { getAccountContext, cleanupContext, withAccountLock } = require('../browser');
const { loadCookies, saveCookies } = require('../session');
const { delay, humanScroll } = require('../humanBehavior');

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

async function readConnectionsInternal({
  accountId,
  proxyUrl,
  limit,
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

    try {
      await page.goto('https://www.linkedin.com/mynetwork/invite-connect/connections/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
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
        return readConnectionsInternal({
          accountId,
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

    await page.waitForSelector('a[href*="/in/"], .mn-connection-card, .artdeco-list__item', {
      timeout: 15000,
    }).catch(() => null);

    for (let i = 0; i < 4; i += 1) {
      await delay(250, 500);
      await humanScroll(page, 1100);
    }

    const items = await page.evaluate((maxItems) => {
      const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const toAbsoluteLinkedInUrl = (href) => {
        if (!href) return null;
        try {
          return new URL(href, 'https://www.linkedin.com').toString();
        } catch {
          return null;
        }
      };
      const looksGeneric = (value) => {
        const normalized = normalizeText(value).toLowerCase();
        if (!normalized) return true;
        return [
          'unknown',
          'linkedin member',
          'member',
          'view profile',
          'message',
          'connect',
        ].includes(normalized);
      };
      const deriveNameFromUrl = (href) => {
        const match = String(href || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
        if (!match?.[1]) return '';
        return normalizeText(
          decodeURIComponent(match[1])
            .replace(/[-_]+/g, ' ')
            .replace(/\b\d+\b/g, '')
        );
      };

      const seen = new Set();
      const results = [];
      const containers = Array.from(
        document.querySelectorAll('.mn-connection-card, .artdeco-list__item, li, main section > div')
      ).filter((node) => node.querySelector('a[href*="/in/"]'));

      for (const container of containers) {
        if (results.length >= maxItems) break;

        const profileLinkEl = container.querySelector('a[href*="/in/"]');
        const profileUrl = toAbsoluteLinkedInUrl(profileLinkEl?.getAttribute('href') || '');
        if (!profileUrl || seen.has(profileUrl)) continue;

        const headlineEl = container.querySelector(
          '.mn-connection-card__occupation, .mn-person-info__occupation, .t-black--light, .t-14'
        );
        const avatarEl = container.querySelector('img');
        const nameCandidates = [
          container.querySelector('[data-anonymize="person-name"]')?.textContent,
          container.querySelector('.mn-connection-card__name')?.textContent,
          container.querySelector('.mn-person-info__name')?.textContent,
          container.querySelector('span[aria-hidden="true"]')?.textContent,
          profileLinkEl?.textContent,
          avatarEl?.getAttribute('alt'),
          deriveNameFromUrl(profileUrl),
        ]
          .map(normalizeText)
          .filter((candidate) => candidate && !looksGeneric(candidate));

        const name = nameCandidates[0] || 'Unknown';
        if (name === 'Unknown') continue;

        seen.add(profileUrl);
        results.push({
          accountId: '',
          name,
          profileUrl,
          headline: normalizeText(headlineEl?.textContent || ''),
          connectedAt: null,
        });
      }

      return results;
    }, limit);

    items.forEach((item) => {
      item.accountId = accountId;
    });

    if (process.env.REFRESH_SESSION_COOKIES === '1') {
      await saveCookies(accountId, await context.cookies(), {
        skipIfMissingAuthCookies: true,
        source: 'readConnections',
      });
    }

    return { items, cursor: null, hasMore: false };
  } catch (err) {
    if (__attempt < 2 && isRecoverableBrowserError(err)) {
      await cleanupContext(accountId).catch(() => {});
      await delay(250, 500);
      return readConnectionsInternal({
        accountId,
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

async function readConnections({ accountId, proxyUrl, limit = 200 }) {
  return withAccountLock(accountId, async () =>
    readConnectionsInternal({
      accountId,
      proxyUrl,
      limit,
      __attempt: 1,
      forceCookieReload: false,
    })
  );
}

module.exports = { readConnections };
