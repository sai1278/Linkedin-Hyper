'use strict';

const { humanClick } = require('../../humanBehavior');
const { COMPOSER_SELECTORS, isAuthwallUrl, isMessagingSurfaceUrl, truncateForLog } = require('./common');
const { logSendStep } = require('./diagnostics');

async function waitForComposerOpen(page, timeoutMs = 7000) {
  const composer = await page.waitForSelector(COMPOSER_SELECTORS, { timeout: timeoutMs }).catch(() => null);
  return Boolean(composer);
}

async function gotoMessagingHomeLenient(page, accountId, timeoutMs = 30000) {
  try {
    await page.goto('https://www.linkedin.com/messaging/', {
      waitUntil: 'commit',
      timeout: Math.min(timeoutMs, 20000),
    });
  } catch (err) {
    const currentUrl = String(page.url() || '');
    if (!isAuthwallUrl(currentUrl) && isMessagingSurfaceUrl(currentUrl)) {
      logSendStep(
        accountId,
        `messaging navigation reported an early error but page is already on messaging: ${truncateForLog(currentUrl, 140)}`
      );
    } else {
      try {
        await page.goto('https://www.linkedin.com/messaging/', {
          waitUntil: 'domcontentloaded',
          timeout: timeoutMs,
        });
      } catch (retryErr) {
        const retryUrl = String(page.url() || '');
        if (!isAuthwallUrl(retryUrl) && isMessagingSurfaceUrl(retryUrl)) {
          logSendStep(
            accountId,
            `messaging navigation timed out but usable messaging URL is present: ${truncateForLog(retryUrl, 140)}`
          );
        } else {
          throw retryErr;
        }
      }
    }
  }

  await page.waitForSelector(
    'main, body, .msg-conversations-container, .msg-overlay-list-bubble, .msg-conversation-listitem',
    { timeout: 12000 }
  ).catch(() => null);

  const landingUrl = String(page.url() || '').toLowerCase();
  if (isAuthwallUrl(landingUrl)) {
    const err = new Error(`Messaging home redirected to auth flow: ${page.url()}`);
    err.code = 'SESSION_EXPIRED';
    err.status = 401;
    throw err;
  }

  return page.url();
}

async function clickVisibleSelector(page, selector, timeoutMs = 2000) {
  try {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible({ timeout: timeoutMs }).catch(() => false);
    if (!visible) return false;
    await humanClick(page, selector, { timeout: Math.max(timeoutMs, 2500) });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  waitForComposerOpen,
  gotoMessagingHomeLenient,
  clickVisibleSelector,
};
