'use strict';

const { getAccountContext, cleanupContext, withAccountLock } = require('../browser');
const { loadCookies, saveCookies } = require('../session');
const { delay }                    = require('../humanBehavior');

function isAuthUrl(url) {
  const value = String(url || '');
  return (
    value.includes('/login') ||
    value.includes('/checkpoint') ||
    value.includes('/authwall')
  );
}

async function inspectAuthState(page) {
  try {
    return await page.evaluate(() => {
      const txt = (document.body?.innerText || '').toLowerCase();
      const hasLoginForm =
        Boolean(document.querySelector('input[name="session_key"], input[name="session_password"], form[action*="login"]'));
      const hasAuthwallMarkers =
        txt.includes('join linkedin') ||
        txt.includes('sign in') ||
        txt.includes('new to linkedin') ||
        txt.includes('continue to linkedin');
      const hasSignedInNav =
        Boolean(document.querySelector('.global-nav, .global-nav__me, [data-test-global-nav]')) ||
        Boolean(document.querySelector('a[href*="/mynetwork/"], a[href*="/messaging/"], a[href*="/feed/"]'));
      const hasMessagingShell =
        Boolean(document.querySelector('.msg-conversations-container, .msg-overlay-list-bubble, .msg-s-message-list'));

      return {
        hasLoginForm,
        hasAuthwallMarkers,
        hasSignedInNav,
        hasMessagingShell,
        url: location.href,
      };
    });
  } catch (err) {
    return {
      hasLoginForm: false,
      hasAuthwallMarkers: false,
      hasSignedInNav: false,
      hasMessagingShell: false,
      url: page.url(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function isAuthenticatedState(state) {
  return Boolean(state?.hasSignedInNav || state?.hasMessagingShell);
}

function isLoggedOutState(state) {
  return Boolean(state?.hasLoginForm || state?.hasAuthwallMarkers);
}

async function tryNavigate(page, url) {
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    return { ok: true, url: page.url() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      url: page.url(),
    };
  }
}

async function verifySession({ accountId, proxyUrl }) {
  return withAccountLock(accountId, async () => {
  // Always verify from a fresh browser context to avoid false positives from
  // previously authenticated in-memory contexts.
  await cleanupContext(accountId).catch(() => {});
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

    // First try feed URL.
    const feedResult = await tryNavigate(page, 'https://www.linkedin.com/feed/');
    await delay(600, 1200);
    const feedUrl = page.url();
    const feedState = await inspectAuthState(page);
    if (
      feedResult.ok &&
      !isAuthUrl(feedUrl) &&
      isAuthenticatedState(feedState) &&
      !isLoggedOutState(feedState)
    ) {
      if (process.env.REFRESH_SESSION_COOKIES === '1') {
        await saveCookies(accountId, await context.cookies());
      }
      return { ok: true, url: feedUrl };
    }

    // Fallback: if feed is blocked/redirected but messaging is still accessible,
    // treat session as valid for this automation workflow.
    const messagingResult = await tryNavigate(page, 'https://www.linkedin.com/messaging/');
    await delay(600, 1200);
    const messagingUrl = page.url();
    const messagingState = await inspectAuthState(page);
    if (
      messagingResult.ok &&
      !isAuthUrl(messagingUrl) &&
      isAuthenticatedState(messagingState) &&
      !isLoggedOutState(messagingState)
    ) {
      if (process.env.REFRESH_SESSION_COOKIES === '1') {
        await saveCookies(accountId, await context.cookies());
      }
      return { ok: true, url: messagingUrl, via: 'messaging-fallback' };
    }

    const details = {
      feed: { ok: feedResult.ok, url: feedUrl, error: feedResult.error || null },
      messaging: { ok: messagingResult.ok, url: messagingUrl, error: messagingResult.error || null },
      authState: {
        feed: feedState,
        messaging: messagingState,
      },
    };
    if (
      String(feedResult.error || '').includes('ERR_TOO_MANY_REDIRECTS') ||
      String(messagingResult.error || '').includes('ERR_TOO_MANY_REDIRECTS') ||
      isAuthUrl(feedUrl) ||
      isAuthUrl(messagingUrl) ||
      isLoggedOutState(feedState) ||
      isLoggedOutState(messagingState)
    ) {
      const err = new Error(`Session expired for account ${accountId}. Re-import cookies.`);
      err.code   = 'SESSION_EXPIRED';
      err.status = 401;
      err.details = details;
      throw err;
    }

    const err = new Error(`Session verification failed for account ${accountId}.`);
    err.code = 'SESSION_VERIFY_FAILED';
    err.status = 500;
    err.details = details;
    throw err;
  } finally {
    if (page) await page.close().catch(() => {});
  }
  });
}

module.exports = { verifySession };
