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
              'a[data-tracking-control-name*="guest_homepage"]',
              'a[data-test-id="home-hero-sign-in-cta"]',
              '.nav__button-secondary',
              'main section a[href*="/signup"]',
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
  const guestOnlyState = Boolean(
    state?.hasGuestCta &&
    !state?.hasSignedInNav &&
    !state?.hasMessagingShell
  );
  return Boolean(state?.hasLoginForm || state?.hasAuthwallMarkers || guestOnlyState);
}

function isStrongMemberUrl(url) {
  const value = String(url || '').toLowerCase();
  if (!value.includes('linkedin.com')) return false;
  if (isBlockedAuthPage(value)) return false;
  try {
    const parsed = new URL(value);
    const path = String(parsed.pathname || '/').toLowerCase();
    return (
      path === '/feed/' ||
      path.startsWith('/feed') ||
      path.startsWith('/messaging') ||
      path.startsWith('/mynetwork') ||
      path.startsWith('/me')
    );
  } catch {
    return false;
  }
}

function isAuthenticatedLinkedInPage(state) {
  const hasUiSignal = Boolean(state?.hasSignedInNav || state?.hasMessagingShell);
  const hasStrongUrlSignal = isStrongMemberUrl(state?.url);
  return Boolean(
    state &&
    !isBlockedAuthPage(state.url) &&
    !isLoggedOutState(state) &&
    (hasUiSignal || hasStrongUrlSignal)
  );
}

async function waitForSettledAuthState(page, timeoutMs = 20000) {
  const deadline = Date.now() + Math.max(1000, timeoutMs);
  let lastState = await inspectAuthState(page);

  while (Date.now() < deadline) {
    if (isAuthenticatedLinkedInPage(lastState)) {
      return lastState;
    }
    await delay(700, 1000);
    lastState = await inspectAuthState(page);
  }

  return lastState;
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

function hasRequiredAuthCookies(flags) {
  return Boolean(flags?.hasLiAt && flags?.hasJsession);
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

async function verifySession({ accountId, proxyUrl, persistCookies = true }) {
  return withAccountLock(accountId, async () => {
  let page;
  let context;

  try {
    const cookies = await loadCookies(accountId);
    if (!cookies || cookies.length === 0) {
      const err = new Error(`No session for account ${accountId}. Import cookies first via POST /accounts/${accountId}/session`);
      err.code   = 'NO_SESSION';
      err.status = 401;
      throw err;
    }

    let lastVerifyError = null;
    const maxVerifyAttempts = 3;

    for (let attempt = 1; attempt <= maxVerifyAttempts; attempt += 1) {
      console.log(`[verifySession:${accountId}] attempt ${attempt}/${maxVerifyAttempts} starting`);
      // Always verify from a fresh browser context to avoid false positives from
      // previously authenticated in-memory contexts and to recover from stale CDP sessions.
      await cleanupContext(accountId).catch(() => {});
      ({ context } = await getAccountContext(accountId, proxyUrl));
      await context.addCookies(cookies);
      page = await context.newPage();

      // Check feed first for baseline auth signal.
      const feedResult = await tryNavigate(page, 'https://www.linkedin.com/feed/');
      await delay(600, 1200);
      const feedUrl = page.url();
      const feedState = await waitForSettledAuthState(page, 20000);

      // Messaging must be accessible for automation sends.
      const messagingResult = await tryNavigate(page, 'https://www.linkedin.com/messaging/');
      await delay(600, 1200);
      const messagingUrl = page.url();
      const messagingState = await waitForSettledAuthState(page, 20000);
      const contextCookies = await context.cookies().catch(() => []);
      const cookieFlags = getCookieFlags(contextCookies);
      const recoverableIssue = [
        feedResult.error,
        messagingResult.error,
        feedState?.error,
        messagingState?.error,
      ].find((value) => isRecoverableBrowserError(value));

      if (recoverableIssue) {
        const recoverableErr = new Error(`Recoverable browser error during verify for ${accountId}: ${recoverableIssue}`);
        recoverableErr.code = 'BROWSER_CONTEXT_CLOSED';
        recoverableErr.status = 503;
        lastVerifyError = recoverableErr;

        if (attempt < maxVerifyAttempts) {
          await page.close().catch(() => {});
          page = null;
          await cleanupContext(accountId).catch(() => {});
          await delay(1200, 1800);
          continue;
        }

        throw recoverableErr;
      }

      // LinkedIn UI markers can be flaky; accept strong member URL signal when required cookies exist.
      // LinkedIn can report navigation errors while still landing on an authenticated page.
      // Trust strong URL/UI member signals when required cookies are present.
      const feedAuthenticated = (
        !isBlockedAuthPage(feedUrl) &&
        hasRequiredAuthCookies(cookieFlags) &&
        (isAuthenticatedLinkedInPage(feedState) || isStrongMemberUrl(feedUrl))
      );

      const messagingAuthenticated = (
        !isBlockedAuthPage(messagingUrl) &&
        hasRequiredAuthCookies(cookieFlags) &&
        (isAuthenticatedLinkedInPage(messagingState) || isStrongMemberUrl(messagingUrl))
      );

      if (messagingAuthenticated || feedAuthenticated) {
        if (persistCookies) {
          await saveCookies(accountId, await context.cookies(), {
            skipIfMissingAuthCookies: true,
            source: 'verifySession',
          });
        }
        console.log(
          `[verifySession:${accountId}] success via=${
            messagingAuthenticated
              ? (feedAuthenticated ? 'feed+messaging' : 'messaging-only')
              : 'feed-only'
          } feedUrl=${feedUrl} messagingUrl=${messagingUrl} cookies=${cookieFlags.total}`
        );
        return {
          ok: true,
          url: messagingAuthenticated ? messagingUrl : feedUrl,
          via: messagingAuthenticated
            ? (feedAuthenticated ? 'feed+messaging' : 'messaging-only')
            : 'feed-only',
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
        attempt,
      };
      const failure = classifyVerifyFailure({
        accountId,
        feedUrl,
        messagingUrl,
        feedState,
        messagingState,
        cookieFlags,
      });

      const screenshot = await captureFailureScreenshot(page, accountId, `verify-${failure.code.toLowerCase()}-attempt-${attempt}`);
      const err = new Error(failure.message);
      if (screenshot) {
        err.message += ` Screenshot: ${screenshot}`;
      }
      err.code = failure.code;
      err.status = 401;
      err.details = details;
      lastVerifyError = err;
      console.warn(
        `[verifySession:${accountId}] attempt ${attempt}/${maxVerifyAttempts} failed code=${failure.code} ` +
        `feedUrl=${feedUrl} messagingUrl=${messagingUrl} feedOk=${feedAuthenticated} messagingOk=${messagingAuthenticated} ` +
        `cookies(li_at=${cookieFlags.hasLiAt},JSESSIONID=${cookieFlags.hasJsession},count=${cookieFlags.total})`
      );

      // Retry once for this flaky LinkedIn state before failing.
      if (failure.code === 'AUTHENTICATED_STATE_NOT_REACHED' && attempt < maxVerifyAttempts) {
        await page.close().catch(() => {});
        page = null;
        await cleanupContext(accountId).catch(() => {});
        await delay(1200, 1800);
        continue;
      }

      throw err;
    }

    if (lastVerifyError) {
      throw lastVerifyError;
    }
  } finally {
    if (page) await page.close().catch(() => {});
  }
  });
}

module.exports = { verifySession };
