'use strict';

const { getAccountContext, cleanupContext, withAccountLock } = require('../browser');
const { loadCookies, saveCookies } = require('../session');
const { delay }                    = require('../humanBehavior');
const fs = require('fs');
const path = require('path');

const DEBUG_SCREENSHOT_DIR =
  process.env.LI_DEBUG_SCREENSHOT_DIR || '/tmp/linkedin-hyper-debug';

function isBlockedAuthPage(url) {
  const value = String(url || '').toLowerCase();
  return (
    value.includes('/uas/login') ||
    value.includes('/login') ||
    value.includes('/checkpoint') ||
    value.includes('/authwall') ||
    value.includes('challenge')
  );
}

function isCheckpointLike(url) {
  const value = String(url || '').toLowerCase();
  return value.includes('/checkpoint') || value.includes('challenge');
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
        txt.includes('continue to linkedin') ||
        txt.includes('unlock your profile') ||
        txt.includes('create your account');
      const navLinkSelectors = [
        'a[href*="/feed"]',
        'a[href*="/mynetwork"]',
        'a[href*="/messaging"]',
        'a[href*="/notifications"]',
      ].join(', ');
      const navLinks = Array.from(document.querySelectorAll(navLinkSelectors))
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const hasPrimaryNavLinks = navLinks.length >= 2;
      const hasSignedInNav = hasPrimaryNavLinks || Boolean(
        document.querySelector(
          [
            '.global-nav__me',
            '.global-nav__me-photo',
            '.global-nav__primary-link-me-menu-trigger',
            '#global-nav-search',
            '.search-global-typeahead',
            '[data-test-global-nav-me]',
            'header.global-nav',
            '.global-nav',
          ].join(', ')
        )
      );
      const hasMessagingShell =
        Boolean(document.querySelector('.msg-conversations-container, .msg-overlay-list-bubble, .msg-s-message-list'));
      const hasGuestCta =
        Boolean(
          document.querySelector(
            [
              'a[href*="/login"]',
              'a[href*="/signup"]',
              'a[data-tracking-control-name*="guest_homepage"]',
              'a[data-test-id="home-hero-sign-in-cta"]',
            ].join(', ')
          )
        );

      return {
        hasLoginForm,
        hasAuthwallMarkers,
        hasSignedInNav,
        hasMessagingShell,
        hasGuestCta,
        url: location.href,
      };
    });
  } catch (err) {
    return {
      hasLoginForm: false,
      hasAuthwallMarkers: false,
      hasSignedInNav: false,
      hasMessagingShell: false,
      hasGuestCta: false,
      url: page.url(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function isAuthenticatedState(state) {
  return Boolean(state?.hasSignedInNav || state?.hasMessagingShell);
}

function isLoggedOutState(state) {
  return Boolean(state?.hasLoginForm || state?.hasAuthwallMarkers || state?.hasGuestCta);
}

function isAuthenticatedLinkedInPage(state) {
  const hasUiSignal = Boolean(state?.hasSignedInNav || state?.hasMessagingShell);
  return Boolean(
    state &&
    !isBlockedAuthPage(state.url) &&
    !isLoggedOutState(state) &&
    hasUiSignal
  );
}

function getCookieFlags(cookies) {
  const list = Array.isArray(cookies) ? cookies : [];
  const linkedIn = list.filter((c) => String(c?.domain || '').includes('linkedin.com'));
  return {
    total: linkedIn.length,
    hasLiAt: linkedIn.some((c) => c?.name === 'li_at' && c?.value),
    hasJsession: linkedIn.some((c) => c?.name === 'JSESSIONID' && c?.value),
  };
}

function classifyVerifyFailure({ accountId, feedUrl, messagingUrl, feedState, messagingState, cookieFlags }) {
  if (!cookieFlags.hasLiAt || !cookieFlags.hasJsession) {
    return {
      code: 'COOKIES_MISSING',
      message: `Required LinkedIn cookies (li_at/JSESSIONID) are missing for account ${accountId}. Re-import cookies.`,
    };
  }
  if (isCheckpointLike(feedUrl) || isCheckpointLike(messagingUrl)) {
    return {
      code: 'CHECKPOINT_INCOMPLETE',
      message: `LinkedIn checkpoint/challenge is still pending for account ${accountId}. Complete checkpoint and re-import cookies.`,
    };
  }
  if (isBlockedAuthPage(feedUrl) || isBlockedAuthPage(messagingUrl) || isLoggedOutState(feedState) || isLoggedOutState(messagingState)) {
    return {
      code: 'LOGIN_NOT_FINISHED',
      message: `LinkedIn login is not fully completed for account ${accountId}. Complete login and re-import cookies.`,
    };
  }
  return {
    code: 'AUTHENTICATED_STATE_NOT_REACHED',
    message: `Authenticated LinkedIn member state was not reached for account ${accountId}. Re-import cookies.`,
  };
}

function safeName(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown';
}

async function captureFailureScreenshot(page, accountId, label) {
  try {
    if (!page || page.isClosed?.()) return null;
    fs.mkdirSync(DEBUG_SCREENSHOT_DIR, { recursive: true });
    const filename = `${safeName(accountId)}-${Date.now()}-${safeName(label)}.png`;
    const filePath = path.join(DEBUG_SCREENSHOT_DIR, filename);
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  } catch (_) {
    return null;
  }
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

    // Check feed first for baseline auth signal.
    const feedResult = await tryNavigate(page, 'https://www.linkedin.com/feed/');
    await delay(600, 1200);
    const feedUrl = page.url();
    const feedState = await inspectAuthState(page);

    // Messaging must be accessible for automation sends.
    const messagingResult = await tryNavigate(page, 'https://www.linkedin.com/messaging/');
    await delay(600, 1200);
    const messagingUrl = page.url();
    const messagingState = await inspectAuthState(page);
    const contextCookies = await context.cookies().catch(() => []);
    const cookieFlags = getCookieFlags(contextCookies);

    const feedAuthenticated = (
      feedResult.ok &&
      !isBlockedAuthPage(feedUrl) &&
      isAuthenticatedLinkedInPage(feedState)
    );

    const messagingAuthenticated = (
      messagingResult.ok &&
      !isBlockedAuthPage(messagingUrl) &&
      isAuthenticatedLinkedInPage(messagingState)
    );

    if (messagingAuthenticated) {
      if (process.env.REFRESH_SESSION_COOKIES === '1') {
        await saveCookies(accountId, await context.cookies(), {
          skipIfMissingAuthCookies: true,
          source: 'verifySession',
        });
      }
      return {
        ok: true,
        url: messagingUrl,
        via: feedAuthenticated ? 'feed+messaging' : 'messaging-only',
      };
    }

    const details = {
      feed: { ok: feedResult.ok, url: feedUrl, error: feedResult.error || null },
      messaging: { ok: messagingResult.ok, url: messagingUrl, error: messagingResult.error || null },
      authState: {
        feed: feedState,
        messaging: messagingState,
      },
      cookieFlags,
    };
    const failure = classifyVerifyFailure({
      accountId,
      feedUrl,
      messagingUrl,
      feedState,
      messagingState,
      cookieFlags,
    });

    const screenshot = await captureFailureScreenshot(page, accountId, `verify-${failure.code.toLowerCase()}`);
    const err = new Error(failure.message);
    if (screenshot) {
      err.message += ` Screenshot: ${screenshot}`;
    }
    err.code = failure.code;
    err.status = 401;
    err.details = details;
    throw err;
  } finally {
    if (page) await page.close().catch(() => {});
  }
  });
}

module.exports = { verifySession };
