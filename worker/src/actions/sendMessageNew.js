'use strict';

const { getAccountContext, cleanupContext, withAccountLock } = require('../browser');
const { loadCookies, saveCookies }                  = require('../session');
const { delay, humanClick, humanScroll, humanType } = require('../humanBehavior');
const { checkAndIncrement }                         = require('../rateLimit');
const fs                                            = require('fs');
const path                                          = require('path');
const { getRedis }                                  = require('../redisClient');
const { createSendMessageThreadHelpers }            = require('../services/sendMessageThreadHelpers');

const COMPOSER_SELECTORS = [
  '.msg-form__contenteditable',
  '[contenteditable][role="textbox"]',
  'div[role="textbox"][contenteditable="true"]',
  '[data-view-name="messaging-compose-box"] [contenteditable="true"]',
  '.msg-form textarea',
  '.msg-form__msg-content-container textarea',
  '[data-view-name="messaging-compose-box"] textarea',
].join(', ');

const MESSAGING_COMPOSE_TRIGGER_SELECTORS = [
  'button[aria-label*="New message"]',
  'button[aria-label*="Compose message"]',
  'button[aria-label*="New conversation"]',
  'a[aria-label*="New message"]',
  'button[data-control-name*="compose"]',
  'a[data-control-name*="compose"]',
  'button[data-test-id*="compose"]',
  '.msg-overlay-bubble-header__control--new-message',
].join(', ');

const MESSAGING_RECIPIENT_INPUT_SELECTORS = [
  'input[placeholder*="Type a name"]',
  'input[aria-label*="Type a name"]',
  'input[placeholder*="Type a name or multiple names"]',
  'input[aria-label*="Type a name or multiple names"]',
  '.msg-form__recipients input',
  '.msg-connections-typeahead__search-field',
  '[role="combobox"] input',
].join(', ');

const DEBUG_SCREENSHOT_DIR =
  process.env.LI_DEBUG_SCREENSHOT_DIR || '/tmp/linkedin-hyper-debug';

const PROFILE_DIRECT_MESSAGE_SELECTORS = [
  'main button[aria-label*="Message"]',
  'main a[aria-label*="Message"]',
  'main button[data-control-name*="message"]',
  'main a[data-control-name*="message"]',
  'main button[data-test-id*="message"]',
  'main a[data-test-id*="message"]',
];

const PROFILE_TOP_ACTION_SELECTORS = [
  '.pv-top-card-v2-ctas button[aria-label*="Message"]',
  '.pv-top-card-v2-ctas a[aria-label*="Message"]',
  '.pvs-profile-actions button[aria-label*="Message"]',
  '.pvs-profile-actions a[aria-label*="Message"]',
  'main .artdeco-button[aria-label*="Message"]',
];

const PROFILE_MORE_ACTION_SELECTORS = [
  'button[aria-label*="More actions"]',
  'button[aria-label*="More"]',
  'button[data-control-name*="overflow"]',
  'button[data-control-name*="more"]',
  'div[role="button"][aria-label*="More"]',
];

const PROFILE_DEBUG_ENABLED = process.env.LI_PROFILE_DEBUG !== '0';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isGenericUiLabel(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return true;

  if (/^\d+$/.test(normalized)) return true;
  if (/^\d+\s*(notification|notifications|message|messages)(\s+total)?$/.test(normalized)) return true;
  if (/^(notification|notifications|message|messages)\s+total$/.test(normalized)) return true;

  const blocked = new Set([
    'unknown',
    'inbox',
    'messages',
    'activity',
    'notifications',
    'notifications total',
    'loading',
    'linkedin',
    'feed',
    'search',
  ]);
  return blocked.has(normalized);
}

function slugToName(slug) {
  return normalizeText(
    String(slug || '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\d+\b/g, '')
  );
}

function deriveNameFromProfileUrl(profileUrl) {
  const match = String(profileUrl || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match?.[1]) return 'Unknown';
  const name = slugToName(match[1]);
  return name || 'Unknown';
}

function normalizeParticipantName(candidate, profileUrl) {
  const parsed = normalizeText(candidate);
  if (parsed && !isGenericUiLabel(parsed)) {
    return parsed;
  }
  return deriveNameFromProfileUrl(profileUrl);
}

function normalizeProfileUrlForCompare(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return String(url || '').trim().replace(/\/+$/, '');
  }
}

function isAuthwallUrl(url) {
  const value = String(url || '').toLowerCase();
  return (
    value.includes('/login') ||
    value.includes('/checkpoint') ||
    value.includes('/authwall') ||
    value.includes('/challenge')
  );
}

function isMessagingSurfaceUrl(url) {
  const value = String(url || '').toLowerCase();
  return value.includes('linkedin.com') && value.includes('/messaging');
}

function logSendStep(accountId, message) {
  console.log(`[sendMessageNew:${accountId}] ${message}`);
}

function truncateForLog(value, max = 120) {
  const normalized = normalizeText(value);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

function summarizeSelectorCounts(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return 'none';
  return entries
    .map((entry) => `${entry.selector}=${entry.visibleCount}/${entry.count}`)
    .join(' | ');
}

async function collectProfileActionDebugSnapshot(page, { messageSelectors, moreSelectors }) {
  try {
    return await page.evaluate(({ messageSelectors, moreSelectors }) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const hidden =
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0' ||
          el.getAttribute('aria-hidden') === 'true';
        return !hidden && rect.width > 0 && rect.height > 0;
      };

      const countBySelector = (selector) => {
        const nodes = Array.from(document.querySelectorAll(selector));
        const visibleCount = nodes.filter(isVisible).length;
        return { selector, count: nodes.length, visibleCount };
      };

      const messageSelectorCounts = messageSelectors.map(countBySelector);
      const moreSelectorCounts = moreSelectors.map(countBySelector);
      const hasVisibleMessageButton = messageSelectorCounts.some((x) => x.visibleCount > 0);
      const hasVisibleMoreButton = moreSelectorCounts.some((x) => x.visibleCount > 0);

      const actionNodes = Array.from(
        document.querySelectorAll('main button, main a, main [role="button"], main div[role="button"]')
      );
      const visibleActionTexts = Array.from(
        new Set(
          actionNodes
            .filter(isVisible)
            .map((el) => normalize(el.getAttribute('aria-label') || el.textContent || ''))
            .filter(Boolean)
        )
      ).slice(0, 25);

      return {
        url: location.href,
        title: document.title || '',
        messageSelectorCounts,
        moreSelectorCounts,
        hasVisibleMessageButton,
        hasVisibleMoreButton,
        visibleActionTexts,
      };
    }, { messageSelectors, moreSelectors });
  } catch (err) {
    return {
      url: page.url(),
      title: '',
      messageSelectorCounts: [],
      moreSelectorCounts: [],
      hasVisibleMessageButton: false,
      hasVisibleMoreButton: false,
      visibleActionTexts: [],
      error: String(err?.message || err),
    };
  }
}

function logProfileActionDebug(accountId, snapshot) {
  if (!PROFILE_DEBUG_ENABLED || !snapshot) return;

  logSendStep(accountId, `[debug] profile URL after navigation: ${snapshot.url || '(unknown)'}`);
  logSendStep(accountId, `[debug] profile title: ${truncateForLog(snapshot.title || '(empty)')}`);
  logSendStep(
    accountId,
    `[debug] message selector counts: ${summarizeSelectorCounts(snapshot.messageSelectorCounts)}`
  );
  logSendStep(
    accountId,
    `[debug] visible Message button exists: ${snapshot.hasVisibleMessageButton ? 'yes' : 'no'}`
  );
  logSendStep(
    accountId,
    `[debug] visible More button exists: ${snapshot.hasVisibleMoreButton ? 'yes' : 'no'}`
  );
  logSendStep(
    accountId,
    `[debug] more selector counts: ${summarizeSelectorCounts(snapshot.moreSelectorCounts)}`
  );
  logSendStep(
    accountId,
    `[debug] visible action texts: ${(
      snapshot.visibleActionTexts || []
    ).map((txt) => `"${truncateForLog(txt, 80)}"`).join(', ') || '(none)'}`
  );
}

function ensureDebugDir() {
  try {
    fs.mkdirSync(DEBUG_SCREENSHOT_DIR, { recursive: true });
  } catch (_) {}
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
    ensureDebugDir();
    const filename = `${safeName(accountId)}-${Date.now()}-${safeName(label)}.png`;
    const filePath = path.join(DEBUG_SCREENSHOT_DIR, filename);
    await page.screenshot({ path: filePath, fullPage: true });
    console.warn(`[sendMessageNew:${accountId}] screenshot saved: ${filePath}`);
    return filePath;
  } catch (err) {
    console.warn(
      `[sendMessageNew:${accountId}] screenshot capture failed: ${String(err?.message || err)}`
    );
    return null;
  }
}

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

async function clickMessageByText(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const hidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
      return !hidden && rect.width > 0 && rect.height > 0;
    };

    const scopes = [
      document.querySelector('.pv-top-card-v2-ctas'),
      document.querySelector('.pvs-profile-actions'),
      document.querySelector('main'),
      document,
    ].filter(Boolean);

    for (const scope of scopes) {
      const nodes = Array.from(scope.querySelectorAll('button, a, div[role="button"]'));
      const candidate = nodes.find((el) => {
        if (!isVisible(el)) return false;
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (el.getAttribute('disabled') !== null || el.getAttribute('aria-disabled') === 'true') return false;
        return aria.includes('message') || txt === 'message' || txt.startsWith('message ');
      });
      if (candidate) {
        candidate.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return { clicked: true, matchedText: (candidate.textContent || '').trim() || candidate.getAttribute('aria-label') || '' };
      }
    }

    return { clicked: false, matchedText: '' };
  }).catch(() => ({ clicked: false, matchedText: '' }));
}

async function clickMessageInOverflowMenu(page) {
  return page.evaluate(() => {
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const hidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
      return !hidden && rect.width > 0 && rect.height > 0;
    };

    const candidates = Array.from(
      document.querySelectorAll(
        [
          'div[role="menu"] [role="menuitem"]',
          '.artdeco-dropdown__content-inner [role="menuitem"]',
          '.artdeco-dropdown__content-inner button',
          '.artdeco-dropdown__content-inner a',
          '.artdeco-dropdown__item',
          '[data-control-name*="message"]',
        ].join(', ')
      )
    );

    const target = candidates.find((el) => {
      if (!isVisible(el)) return false;
      const text = `${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`.toLowerCase();
      return text.includes('message');
    });

    if (!target) return { clicked: false, disabled: false, label: '' };

    const disabled = target.getAttribute('disabled') !== null || target.getAttribute('aria-disabled') === 'true';
    const label = `${target.getAttribute('aria-label') || ''} ${target.textContent || ''}`.replace(/\s+/g, ' ').trim();
    if (disabled) return { clicked: false, disabled: true, label };

    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return { clicked: true, disabled: false, label };
  }).catch(() => ({ clicked: false, disabled: false, label: '' }));
}

async function clickMessageTriggerOnProfile(page, { accountId, profileUrl, maxAttempts = 3 }) {
  let lastReason = 'No visible Message action was found on this profile.';
  let disabledMessageDetected = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    logSendStep(accountId, `message-button search attempt ${attempt}/${maxAttempts}`);
    await page.waitForSelector('main, body', { timeout: 12000 }).catch(() => null);

    const strategyGroups = [
      { name: 'direct-message-button', selectors: PROFILE_DIRECT_MESSAGE_SELECTORS },
      { name: 'top-action-bar', selectors: PROFILE_TOP_ACTION_SELECTORS },
    ];

    for (const group of strategyGroups) {
      for (const selector of group.selectors) {
        const clicked = await clickVisibleSelector(page, selector, 1500);
        if (!clicked) continue;
        logSendStep(accountId, `message button found via ${group.name}: ${selector}`);
        if (await waitForComposerOpen(page, 7000)) {
          logSendStep(accountId, `composer opened via selector: ${selector}`);
          return { opened: true, strategy: group.name, matched: selector };
        }
        lastReason = `Selector matched (${selector}) but composer did not open.`;
        const shot = await captureFailureScreenshot(page, accountId, `composer-not-open-${attempt}`);
        if (shot) logSendStep(accountId, `composer did not open; screenshot: ${shot}`);
      }
    }

    const textClick = await clickMessageByText(page);
    if (textClick.clicked) {
      logSendStep(accountId, `message button found via text strategy: ${textClick.matchedText || '(text-match)'}`);
      if (await waitForComposerOpen(page, 7000)) {
        logSendStep(accountId, 'composer opened via text strategy');
        return { opened: true, strategy: 'text-based', matched: textClick.matchedText || 'message-text' };
      }
      lastReason = 'Text-based Message control clicked but composer did not open.';
      const shot = await captureFailureScreenshot(page, accountId, `composer-not-open-text-${attempt}`);
      if (shot) logSendStep(accountId, `composer not open after text-click; screenshot: ${shot}`);
    }

    for (const moreSelector of PROFILE_MORE_ACTION_SELECTORS) {
      const openedMore = await clickVisibleSelector(page, moreSelector, 1200);
      if (!openedMore) continue;
      logSendStep(accountId, `overflow opened via selector: ${moreSelector}`);
      await delay(300, 700);
      const overflowResult = await clickMessageInOverflowMenu(page);
      if (overflowResult.disabled) {
        disabledMessageDetected = true;
        lastReason = `Message option is present but disabled in overflow menu (${overflowResult.label || 'Message'}).`;
        break;
      }
      if (overflowResult.clicked) {
        logSendStep(accountId, `message selected from overflow menu: ${overflowResult.label || 'Message'}`);
        if (await waitForComposerOpen(page, 7000)) {
          logSendStep(accountId, 'composer opened via overflow menu');
          return { opened: true, strategy: 'overflow-menu', matched: overflowResult.label || moreSelector };
        }
        lastReason = 'Message menu item clicked in overflow menu but composer did not open.';
        const shot = await captureFailureScreenshot(page, accountId, `composer-not-open-overflow-${attempt}`);
        if (shot) logSendStep(accountId, `composer not open after overflow click; screenshot: ${shot}`);
      }
    }

    if (attempt < maxAttempts) {
      await humanScroll(page, 180).catch(() => {});
      await delay(500, 900);
    }
  }

  const screenshotPath = await captureFailureScreenshot(page, accountId, 'message-button-not-found');
  const reason = disabledMessageDetected
    ? 'Profile has a Message action but it is disabled for this account (likely not connected or restricted).'
    : `No usable Message action was found on profile page ${profileUrl}.`;
  if (screenshotPath) {
    logSendStep(accountId, `message button not found; screenshot: ${screenshotPath}`);
  }

  return {
    opened: false,
    reason: `${reason} ${lastReason}`.trim(),
    screenshotPath,
  };
}

async function openComposerFromPeopleSearch(page, { accountId, profileUrl, participantName }) {
  const searchQuery = normalizeText(participantName) || deriveNameFromProfileUrl(profileUrl);
  if (!searchQuery || searchQuery === 'Unknown') {
    return { opened: false, reason: 'No usable person name available for LinkedIn people search.' };
  }

  const normalizedProfileUrl = normalizeProfileUrlForCompare(profileUrl);
  const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchQuery)}&origin=GLOBAL_SEARCH_HEADER`;
  logSendStep(accountId, `opening people search for composer fallback: ${searchQuery}`);

  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    return { opened: false, reason: `People search navigation failed: ${String(err?.message || err)}` };
  }

  await page.waitForSelector('.reusable-search__result-container, .search-results-container, main', {
    timeout: 15000,
  }).catch(() => null);
  await delay(1000, 1800);

  const clickResult = await page.evaluate((targetProfileUrl) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const normalizeUrl = (value) => {
      try {
        const parsed = new URL(String(value || '').trim());
        parsed.hash = '';
        parsed.search = '';
        parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
        return parsed.toString().replace(/\/$/, '');
      } catch {
        return String(value || '').trim().replace(/\/+$/, '');
      }
    };
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const hidden =
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        el.getAttribute('aria-hidden') === 'true';
      return !hidden && rect.width > 0 && rect.height > 0;
    };

    const cards = Array.from(document.querySelectorAll('.reusable-search__result-container, .entity-result, li'))
      .filter((card) => card.querySelector('a[href*="/in/"]'));

    const match = cards.find((card) => {
      const href = card.querySelector('a[href*="/in/"]')?.href || '';
      return href && normalizeUrl(href) === targetProfileUrl;
    });

    if (!match) {
      return { clicked: false, disabled: false, reason: 'Matching search result not found.' };
    }

    const candidates = Array.from(match.querySelectorAll(
      [
        'button[aria-label*="Message"]',
        'a[aria-label*="Message"]',
        'button[data-control-name*="message"]',
        'a[data-control-name*="message"]',
        'button[data-test-id*="message"]',
        'a[data-test-id*="message"]',
      ].join(', ')
    ));

    const target = candidates.find((el) => isVisible(el));
    if (!target) {
      return { clicked: false, disabled: false, reason: 'Search result has no visible Message button.' };
    }

    const disabled =
      target.getAttribute('disabled') !== null ||
      target.getAttribute('aria-disabled') === 'true';
    const label = normalize(target.getAttribute('aria-label') || target.textContent || '');
    if (disabled) {
      return { clicked: false, disabled: true, reason: `Message button is disabled (${label || 'Message'}).` };
    }

    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return { clicked: true, disabled: false, reason: label || 'Message' };
  }, normalizedProfileUrl).catch((err) => ({
    clicked: false,
    disabled: false,
    reason: String(err?.message || err),
  }));

  if (!clickResult.clicked) {
    return { opened: false, reason: clickResult.reason || 'People search could not open the composer.' };
  }

  if (await waitForComposerOpen(page, 12000)) {
    logSendStep(accountId, `composer opened from people search (${clickResult.reason})`);
    return { opened: true, strategy: 'people-search', matched: clickResult.reason || searchQuery };
  }

  const screenshotPath = await captureFailureScreenshot(page, accountId, 'composer-not-open-search-results');
  return {
    opened: false,
    reason: `People search Message action clicked but composer did not open.${screenshotPath ? ` Screenshot: ${screenshotPath}` : ''}`,
    screenshotPath,
  };
}

async function clickMessagingComposeTrigger(page) {
  for (const selector of MESSAGING_COMPOSE_TRIGGER_SELECTORS.split(',').map((item) => item.trim()).filter(Boolean)) {
    const clicked = await clickVisibleSelector(page, selector, 1500);
    if (clicked) {
      return { clicked: true, reason: selector };
    }
  }

  return page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const hidden =
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        el.getAttribute('aria-hidden') === 'true';
      return !hidden && rect.width > 0 && rect.height > 0;
    };

    const nodes = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
    const target = nodes.find((node) => {
      if (!isVisible(node)) return false;
      const label = normalize(`${node.getAttribute('aria-label') || ''} ${node.textContent || ''}`);
      return (
        label.includes('new message') ||
        label.includes('compose message') ||
        label.includes('new conversation')
      );
    });

    if (!target) {
      return { clicked: false, reason: 'Messaging compose trigger not found.' };
    }

    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return {
      clicked: true,
      reason: (target.getAttribute('aria-label') || target.textContent || '').replace(/\s+/g, ' ').trim(),
    };
  }).catch(() => ({ clicked: false, reason: 'Messaging compose trigger could not be activated.' }));
}

async function selectRecipientFromMessagingTypeahead(page, { profileUrl, participantName }) {
  const normalizedProfileUrl = normalizeProfileUrlForCompare(profileUrl);
  const nameNeedle = normalizeParticipantName(participantName, profileUrl).toLowerCase();
  const slugNeedle = slugToName(String(profileUrl || '').match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1] || '').toLowerCase();
  const tokenNeedles = Array.from(new Set(
    `${nameNeedle} ${slugNeedle}`
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  ));

  return page.evaluate(({ targetProfileUrl, exactName, slugHint, tokens }) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const normalizeUrl = (value) => {
      try {
        const parsed = new URL(String(value || '').trim());
        parsed.hash = '';
        parsed.search = '';
        parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
        return parsed.toString().replace(/\/$/, '');
      } catch {
        return String(value || '').trim().replace(/\/+$/, '');
      }
    };
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const hidden =
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        el.getAttribute('aria-hidden') === 'true';
      return !hidden && rect.width > 0 && rect.height > 0;
    };

    const selectorList = [
      '[role="listbox"] [role="option"]',
      '[role="listbox"] li',
      '.msg-connections-typeahead__search-results li',
      '.basic-typeahead__selectable',
      '.artdeco-typeahead__result',
      '.msg-connections-typeahead__search-result',
    ];

    const candidates = [];
    for (const selector of selectorList) {
      for (const node of Array.from(document.querySelectorAll(selector))) {
        if (!isVisible(node)) continue;
        candidates.push(node);
      }
    }

    let best = null;
    for (const node of candidates) {
      const clickable =
        node.closest('[role="option"], button, li, .basic-typeahead__selectable, .artdeco-typeahead__result') ||
        node;
      if (!isVisible(clickable)) continue;

      const href =
        clickable.querySelector?.('a[href*="/in/"]')?.href ||
        clickable.getAttribute?.('href') ||
        '';
      const normalizedHref = normalizeUrl(href);
      const text = normalize(`${clickable.getAttribute?.('aria-label') || ''} ${clickable.textContent || ''}`).toLowerCase();
      if (!text && !normalizedHref) continue;

      let score = 0;
      if (normalizedHref && normalizedHref === targetProfileUrl) score += 10;
      if (exactName && text.includes(exactName)) score += 5;
      if (slugHint && text.includes(slugHint)) score += 3;
      if (Array.isArray(tokens)) {
        let tokenHits = 0;
        for (const token of tokens) {
          if (token && text.includes(String(token).toLowerCase())) {
            tokenHits += 1;
          }
        }
        score += Math.min(4, tokenHits);
      }

      if (!best || score > best.score) {
        best = {
          score,
          label: normalize(clickable.getAttribute?.('aria-label') || clickable.textContent || ''),
          href: normalizedHref,
          node: clickable,
        };
      }
    }

    if (!best || best.score < 2) {
      return { clicked: false, reason: 'No matching recipient result found in messaging typeahead.' };
    }

    best.node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return {
      clicked: true,
      reason: best.label || best.href || 'recipient-selected',
    };
  }, {
    targetProfileUrl: normalizedProfileUrl,
    exactName: nameNeedle,
    slugHint: slugNeedle,
    tokens: tokenNeedles,
  }).catch((err) => ({
    clicked: false,
    reason: String(err?.message || err),
  }));
}

async function openComposerFromMessagingHome(page, { accountId, profileUrl, participantName }) {
  const searchQuery = normalizeText(participantName) || deriveNameFromProfileUrl(profileUrl);
  if (!searchQuery || searchQuery === 'Unknown') {
    return { opened: false, reason: 'No usable participant name available for messaging compose.' };
  }

  logSendStep(accountId, `opening messaging home for compose fallback: ${searchQuery}`);
  try {
    await gotoMessagingHomeLenient(page, accountId, 30000);
  } catch (err) {
    return { opened: false, reason: `Messaging home navigation failed: ${String(err?.message || err)}` };
  }

  await delay(800, 1400);

  let currentThreadMatch = await resolveThreadIdFromCurrentMessagingView(page, {
    profileUrl,
    participantName: searchQuery,
    messageText: '',
  });
  if (!currentThreadMatch.threadId) {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && !currentThreadMatch.threadId) {
      await delay(500, 800);
      currentThreadMatch = await resolveThreadIdFromCurrentMessagingView(page, {
        profileUrl,
        participantName: searchQuery,
        messageText: '',
      });
    }
  }

  if (currentThreadMatch.threadId) {
    const composerReady = await waitForComposerOpen(page, 12000);
    if (composerReady) {
      logSendStep(
        accountId,
        `reusing already-open messaging thread (${currentThreadMatch.reason || 'matched-current-thread'})`
      );
      return {
        opened: true,
        strategy: 'existing-thread',
        matched: currentThreadMatch.reason || searchQuery,
        threadId: currentThreadMatch.threadId,
      };
    }
  }

  const currentUrlThreadId = extractThreadIdFromText(page.url());
  if (isValidThreadId(currentUrlThreadId)) {
    const normalizedTargetProfileUrl = normalizeProfileUrlForCompare(profileUrl);
    const hasTargetProfileLink = await page.evaluate((targetProfileUrl) => {
      const normalizeUrl = (value) => {
        try {
          const parsed = new URL(String(value || '').trim());
          parsed.hash = '';
          parsed.search = '';
          parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
          return parsed.toString().replace(/\/$/, '');
        } catch {
          return String(value || '').trim().replace(/\/+$/, '');
        }
      };

      if (!targetProfileUrl) return false;
      const anchors = Array.from(document.querySelectorAll('a[href*="/in/"]'));
      return anchors.some((anchor) => {
        const href = anchor.href || anchor.getAttribute?.('href') || '';
        return normalizeUrl(href) === targetProfileUrl;
      });
    }, normalizedTargetProfileUrl).catch(() => false);

    if (hasTargetProfileLink) {
      const composerReady = await waitForComposerOpen(page, 12000);
      if (composerReady) {
        logSendStep(accountId, 'reusing current messaging thread via URL/profile-link fallback');
        return {
          opened: true,
          strategy: 'existing-thread-url',
          matched: 'profile-link-in-current-thread',
          threadId: currentUrlThreadId,
        };
      }
    }
  }

  const triggerResult = await clickMessagingComposeTrigger(page);
  if (!triggerResult.clicked) {
    return { opened: false, reason: triggerResult.reason || 'Messaging compose trigger not available.' };
  }

  logSendStep(accountId, `messaging compose trigger activated: ${triggerResult.reason}`);

  const recipientInput = await page.waitForSelector(MESSAGING_RECIPIENT_INPUT_SELECTORS, {
    timeout: 12000,
  }).catch(() => null);
  if (!recipientInput) {
    const screenshotPath = await captureFailureScreenshot(page, accountId, 'messaging-compose-recipient-missing');
    return {
      opened: false,
      reason: `Messaging compose opened but recipient input did not appear.${screenshotPath ? ` Screenshot: ${screenshotPath}` : ''}`,
      screenshotPath,
    };
  }

  try {
    await humanType(page, MESSAGING_RECIPIENT_INPUT_SELECTORS, searchQuery, { timeout: 12000 });
  } catch (err) {
    return { opened: false, reason: `Could not type recipient into messaging compose: ${String(err?.message || err)}` };
  }

  await delay(1200, 1800);

  const recipientResult = await selectRecipientFromMessagingTypeahead(page, { profileUrl, participantName: searchQuery });
  if (!recipientResult.clicked) {
    const screenshotPath = await captureFailureScreenshot(page, accountId, 'messaging-compose-recipient-not-found');
    return {
      opened: false,
      reason: `${recipientResult.reason || 'Recipient selection failed in messaging compose.'}${screenshotPath ? ` Screenshot: ${screenshotPath}` : ''}`,
      screenshotPath,
    };
  }

  logSendStep(accountId, `messaging compose recipient selected: ${recipientResult.reason}`);

  if (await waitForComposerOpen(page, 12000)) {
    return { opened: true, strategy: 'messaging-compose', matched: recipientResult.reason || searchQuery };
  }

  const screenshotPath = await captureFailureScreenshot(page, accountId, 'messaging-compose-composer-not-open');
  return {
    opened: false,
    reason: `Recipient was selected from messaging compose but message box did not open.${screenshotPath ? ` Screenshot: ${screenshotPath}` : ''}`,
    screenshotPath,
  };
}

const {
  normalizeThreadIdCandidate,
  isValidThreadId,
  createNetworkThreadIdProbe,
  getMessageSnapshot,
  verifyMessageEcho,
  resolveThreadIdAfterSend,
  resolveThreadIdFromConversationPreview,
  resolveThreadIdFromMessagingHome,
  resolveThreadIdByClickingConversationCandidates,
  confirmMessagePersistedInThread,
  confirmMessageVisibleInCurrentView,
} = createSendMessageThreadHelpers({
  delay,
  normalizeText,
  slugToName,
  normalizeProfileUrlForCompare,
  gotoMessagingHomeLenient,
  logSendStep,
  truncateForLog,
});

function isRecoverableBrowserError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (!msg) return false;

  return (
    msg === 'operation failed' ||
    msg.includes('operation failed') ||
    msg.includes('session closed') ||
    msg.includes('frame was detached') ||
    msg.includes('target page, context or browser has been closed') ||
    msg.includes('protocol error (page.createisolatedworld)') ||
    msg.includes('protocol error (page.addscripttoevaluateonnewdocument)') ||
    msg.includes('net::err_aborted')
  );
}

async function isComposerDraftCleared(page) {
  try {
    return await page.evaluate(() => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const selectors = [
        '.msg-form__contenteditable',
        '[contenteditable][role="textbox"]',
        'div[role="textbox"][contenteditable="true"]',
        '[data-view-name="messaging-compose-box"] [contenteditable="true"]',
        '.msg-form textarea',
        '.msg-form__msg-content-container textarea',
        '[data-view-name="messaging-compose-box"] textarea',
      ];

      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!node) continue;
        const value =
          node.tagName === 'TEXTAREA'
            ? normalize(node.value)
            : normalize(node.textContent);
        if (value) return false;
      }
      return true;
    });
  } catch {
    return false;
  }
}

async function detectSendErrorBanner(page) {
  try {
    return await page.evaluate(() => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const hay = normalize(document.body?.innerText || '');
      if (!hay) return false;

      const patterns = [
        'unable to send',
        'couldn\'t send',
        'could not send',
        'message not sent',
        'failed to send',
        'try again',
      ];

      return patterns.some((p) => hay.includes(p));
    });
  } catch {
    return false;
  }
}

async function sendMessageNewInternal({ accountId, profileUrl, chatId, text, proxyUrl, __attempt = 1 }) {
  // W2 — checkAndIncrement moved to AFTER successful send.
  await cleanupContext(accountId).catch(() => {});
  const { context, cookiesLoaded } = await getAccountContext(accountId, proxyUrl);
  let page;
  let networkThreadProbe = null;
  let preResolvedChatId = '';
  const directThreadId = isValidThreadId(chatId) ? normalizeThreadIdCandidate(chatId) : '';

  try {
    // W1 — Only inject cookies on a cache miss.
    if (!cookiesLoaded) {
      const cookies = await loadCookies(accountId);
      if (!cookies) {
        const err = new Error(`No session for account ${accountId}`);
        err.code = 'NO_SESSION'; err.status = 401;
        throw err;
      }
      await context.addCookies(cookies);
    }
    page = await context.newPage();

    // W3 — Avoid slug-based direct thread/new URLs here. Public profile slugs are not
    // a reliable recipient identifier, and this path can clear the composer without
    // ever creating a real thread.
    let participantName = normalizeParticipantName('', profileUrl);
    let usedDirectUrl = false;

    if (directThreadId) {
      logSendStep(accountId, `opening existing thread: ${directThreadId}`);
      try {
        await page.goto(`https://www.linkedin.com/messaging/thread/${directThreadId}/`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
      } catch (navErr) {
        const navMsg = String(navErr?.message || navErr);
        if (navMsg.includes('ERR_TOO_MANY_REDIRECTS')) {
          const err = new Error(`Session expired for account ${accountId}. Re-import cookies.`);
          err.code = 'SESSION_EXPIRED'; err.status = 401;
          throw err;
        }
        throw navErr;
      }

      if (isAuthwallUrl(page.url())) {
        const err = new Error(`Session expired for account ${accountId}. Re-import cookies.`);
        err.code = 'SESSION_EXPIRED'; err.status = 401;
        throw err;
      }

      const threadComposer = await page
        .waitForSelector(COMPOSER_SELECTORS, { timeout: 20000 })
        .catch(() => null);

      if (threadComposer) {
        usedDirectUrl = true;
        preResolvedChatId = directThreadId;

        try {
          const candidateName = await page.evaluate(() => {
            const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const nameEl = document.querySelector(
              '.msg-thread__name, .msg-entity-lockup__entity-title, [data-anonymize="person-name"], h1, h2'
            );
            return normalize(nameEl?.textContent || '');
          });
          if (candidateName) {
            participantName = normalizeParticipantName(candidateName, profileUrl);
          }
        } catch (_) {}
      }

      if (!usedDirectUrl) {
        const err = new Error('Existing LinkedIn thread is not replyable because the composer could not be opened.');
        err.code = 'THREAD_NOT_REPLYABLE';
        err.status = 409;
        throw err;
      }
    }

    if (!usedDirectUrl) {
      // Fallback 1: if conversation already exists, open from messaging home directly.
      try {
        const existingThreadId = await resolveThreadIdFromMessagingHome(
          page,
          { accountId, profileUrl, participantName, messageText: '' },
          12000
        );
        if (isValidThreadId(existingThreadId)) {
          await page.goto(`https://www.linkedin.com/messaging/thread/${existingThreadId}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          const threadComposer = await page
            .waitForSelector(COMPOSER_SELECTORS, { timeout: 20000 })
            .catch(() => null);
          if (threadComposer) {
            usedDirectUrl = true;
            preResolvedChatId = existingThreadId;
          }
        }
      } catch (_) {}
    }

    if (!usedDirectUrl) {
      // Fallback 2: create a new conversation entirely inside LinkedIn Messaging.
      try {
        const messagingComposerResult = await openComposerFromMessagingHome(page, {
          accountId,
          profileUrl,
          participantName,
        });
        if (messagingComposerResult.opened) {
          usedDirectUrl = true;
          if (messagingComposerResult.threadId) {
            preResolvedChatId = messagingComposerResult.threadId;
          }
          logSendStep(accountId, `composer opened via messaging home fallback (${messagingComposerResult.matched})`);
        } else {
          logSendStep(accountId, `messaging-home fallback unavailable: ${messagingComposerResult.reason}`);
        }
      } catch (_) {}
    }

    if (!usedDirectUrl) {
      // Fallback 2b: resolve and open an existing thread from the messaging conversation list.
      try {
        const conversationThreadId = await resolveThreadIdByClickingConversationCandidates(
          page,
          { accountId, profileUrl, participantName, messageText: '' },
          15000
        );
        if (isValidThreadId(conversationThreadId)) {
          await page.goto(`https://www.linkedin.com/messaging/thread/${conversationThreadId}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          const threadComposer = await page
            .waitForSelector(COMPOSER_SELECTORS, { timeout: 15000 })
            .catch(() => null);
          if (threadComposer) {
            usedDirectUrl = true;
            preResolvedChatId = conversationThreadId;
            logSendStep(accountId, `composer opened via conversation-list fallback (thread=${conversationThreadId})`);
          } else {
            logSendStep(accountId, 'conversation-list fallback found thread but composer was unavailable');
          }
        } else {
          logSendStep(accountId, 'conversation-list fallback did not resolve a target thread');
        }
      } catch (err) {
        logSendStep(accountId, `conversation-list fallback unavailable: ${String(err?.message || err)}`);
      }
    }

    if (!usedDirectUrl) {
      // Fallback 3: open from LinkedIn people search before touching the profile page.
      try {
        const searchComposerResult = await openComposerFromPeopleSearch(page, {
          accountId,
          profileUrl,
          participantName,
        });
        if (searchComposerResult.opened) {
          usedDirectUrl = true;
          logSendStep(accountId, 'composer opened via people-search fallback');
        } else {
          logSendStep(accountId, `people-search fallback unavailable: ${searchComposerResult.reason}`);
        }
      } catch (_) {}
    }

    if (!usedDirectUrl) {
      // Fallback 4: navigate to recipient's profile page and click "Message"
      logSendStep(accountId, `opening profile URL: ${profileUrl}`);
      try {
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (navErr) {
        const navMsg = String(navErr?.message || navErr);
        const wrappedErr = new Error(`Profile navigation failed while opening message composer: ${navMsg}`);
        const navMsgLower = navMsg.toLowerCase();
        if (navMsgLower.includes('err_too_many_redirects')) {
          wrappedErr.code = 'NAVIGATION_REDIRECT_LOOP';
        } else if (navMsgLower.includes('timeout')) {
          wrappedErr.code = 'PROFILE_NAVIGATION_TIMEOUT';
        } else {
          wrappedErr.code = 'PROFILE_NAVIGATION_FAILED';
        }
        wrappedErr.status = 502;
        throw wrappedErr;
      }
      await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
      await page.waitForSelector('main, body', { timeout: 15000 }).catch(() => null);
      logSendStep(accountId, `profile page load successful: ${page.url()}`);
      const profileDebugSnapshot = await collectProfileActionDebugSnapshot(page, {
        messageSelectors: [
          ...PROFILE_DIRECT_MESSAGE_SELECTORS,
          ...PROFILE_TOP_ACTION_SELECTORS,
        ],
        moreSelectors: PROFILE_MORE_ACTION_SELECTORS,
      });
      logProfileActionDebug(accountId, profileDebugSnapshot);
      if (profileDebugSnapshot?.error) {
        logSendStep(accountId, `[debug] profile debug collection error: ${profileDebugSnapshot.error}`);
      }

      const landingUrl = page.url();
      if (landingUrl.includes('/login') || landingUrl.includes('/checkpoint') || landingUrl.includes('/authwall')) {
        const authwallShot = await captureFailureScreenshot(page, accountId, 'profile-authwall');
        const err = new Error(`Session expired for account ${accountId}. Re-import cookies.`);
        if (authwallShot) {
          err.message += ` Screenshot: ${authwallShot}`;
        }
        err.code = 'SESSION_EXPIRED'; err.status = 401;
        throw err;
      }
      await delay(2500, 5000); // simulate reading the profile

      await humanScroll(page, 200);
      await delay(800, 1500);

      // Extract profile name near the Message button
      try {
        const candidateName = await page.evaluate((fallbackName) => {
          const messageButton = document.querySelector('button[aria-label*="Message"], a[aria-label*="Message"]');
          const nearestCard   = messageButton?.closest('.pv-top-card, .ph5, .artdeco-card, main, section');
          const scopedName    = nearestCard?.querySelector('h1, [data-anonymize="person-name"], .text-heading-xlarge');
          const fallbackEl    = document.querySelector('h1, [data-anonymize="person-name"], .text-heading-xlarge');
          const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
          const raw = scopedName?.textContent || fallbackEl?.textContent || '';
          return normalize(raw) || fallbackName || 'Unknown';
        }, participantName);
        participantName = normalizeParticipantName(candidateName, profileUrl);
      } catch (_) {}

      const openComposerResult = await clickMessageTriggerOnProfile(page, {
        accountId,
        profileUrl,
        maxAttempts: 3,
      });
      if (!openComposerResult.opened) {
        const screenshotInfo = openComposerResult.screenshotPath
          ? ` Screenshot: ${openComposerResult.screenshotPath}`
          : '';
        const reason = openComposerResult.reason
          || 'Profile is not messageable for this account or LinkedIn UI does not expose a usable Message control.';
        const err = new Error(`Could not open message composer from profile. ${reason}${screenshotInfo}`);
        err.code = 'NOT_MESSAGEABLE';
        err.status = 400;
        throw err;
      }
      logSendStep(
        accountId,
        `composer opened successfully via ${openComposerResult.strategy} (${openComposerResult.matched})`
      );
      await delay(1500, 3000);
    }

    const composeSelector = COMPOSER_SELECTORS;
    const beforeSnapshot = await getMessageSnapshot(page).catch(() => ({ count: 0, lastText: '', recentTexts: [] }));
    try {
      await humanType(page, composeSelector, text, { timeout: 20000 });
    } catch (typeErr) {
      const typeScreenshot = await captureFailureScreenshot(page, accountId, 'composer-input-not-found');
      const msg = String(typeErr?.message || typeErr || '');
      if (msg.includes('waitForSelector') || msg.includes('contenteditable') || msg.includes('textarea')) {
        const err = new Error(
          `Message composer input not available after opening chat. Ensure recipient is messageable for this account.` +
          (typeScreenshot ? ` Screenshot: ${typeScreenshot}` : '')
        );
        err.code = 'NOT_MESSAGEABLE';
        err.status = 400;
        throw err;
      }
      throw typeErr;
    }
    await delay(800, 1800);

    networkThreadProbe = createNetworkThreadIdProbe(page);
    await humanClick(page, '.msg-form__send-button, button[type="submit"][aria-label*="Send"]');
    const verified = await verifyMessageEcho(page, text, beforeSnapshot);
    if (!verified) {
      const err = new Error('Message send could not be confirmed in thread. Retry once with fresh session.');
      err.code = 'SEND_NOT_CONFIRMED';
      err.status = 502;
      throw err;
    }

    // W2 — Burn quota only after the send click succeeds.
    let chatId = preResolvedChatId || (await resolveThreadIdAfterSend(page, 12000));
    if (!chatId) {
      logSendStep(accountId, 'thread id unresolved after URL probe; waiting on network probe');
      chatId = await networkThreadProbe.waitForThreadId(12000);
    }
    if (!chatId) {
      logSendStep(accountId, 'thread id unresolved after network probe; trying conversation preview match');
      chatId = await resolveThreadIdFromConversationPreview(page, text, 12000);
    }
    if (!chatId) {
      logSendStep(accountId, 'thread id unresolved after preview match; scanning messaging home');
      chatId = await resolveThreadIdFromMessagingHome(
        page,
        { accountId, profileUrl, participantName, messageText: text },
        20000
      );
    }
    if (!chatId) {
      logSendStep(accountId, 'thread id unresolved after messaging-home scan; opening ranked conversation rows');
      chatId = await resolveThreadIdByClickingConversationCandidates(
        page,
        { accountId, profileUrl, participantName, messageText: text },
        25000
      );
    }
    if (!chatId) {
      const messageStillVisible = await confirmMessageVisibleInCurrentView(page, text, 15000);
      const composerCleared = await isComposerDraftCleared(page);
      const hasSendErrorBanner = await detectSendErrorBanner(page);
      const unresolvedShot = await captureFailureScreenshot(page, accountId, 'thread-id-unresolved');
      const err = new Error(
        `Send clicked but LinkedIn thread ID was not resolved. Delivery could not be confirmed (visible=${messageStillVisible}, composerCleared=${composerCleared}, errorBanner=${hasSendErrorBanner}).` +
          (unresolvedShot ? ` Screenshot: ${unresolvedShot}` : '')
      );
      err.code = 'SEND_NOT_CONFIRMED';
      err.status = 502;
      throw err;
    }

    const persisted = await confirmMessagePersistedInThread(page, chatId, text, 30000);

    if (!persisted) {
      const persistedShot = await captureFailureScreenshot(page, accountId, 'message-not-found-after-send');
      const err = new Error(
        'Message was not found in thread after send confirmation. Message may not be delivered.' +
        (persistedShot ? ` Screenshot: ${persistedShot}` : '')
      );
      err.code = 'SEND_NOT_CONFIRMED';
      err.status = 502;
      throw err;
    }

    await checkAndIncrement(accountId, 'messagesSent');
    await delay(2000, 4000);

    if (process.env.REFRESH_SESSION_COOKIES === '1') {
      await saveCookies(accountId, await context.cookies(), {
        skipIfMissingAuthCookies: true,
        source: 'sendMessageNew',
      });
    }

    const msgId = `sent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const redis = getRedis();
    const entry = JSON.stringify({
      type: 'messageSent',
      accountId,
      targetName: normalizeParticipantName(participantName, profileUrl),
      targetProfileUrl: profileUrl, // correct: real profile URL
      textPreview: (text || '').slice(0, 200),
      messageLength: text ? text.length : 0,
      timestamp: Date.now(),
    });
    await redis.lpush(`activity:log:${accountId}`, entry);
    await redis.ltrim(`activity:log:${accountId}`, 0, 999);
    await redis.incr(`stats:messages:${accountId}`);

    return {
      id:        msgId,
      chatId,
      senderId:  '__self__',
      text,
      createdAt: new Date().toISOString(),
      isRead:    true,
    };
  } catch (err) {
    if (__attempt < 3 && isRecoverableBrowserError(err)) {
      await cleanupContext(accountId).catch(() => {});
      await delay(700 + (__attempt * 300), 1300 + (__attempt * 300));
      return sendMessageNewInternal({ accountId, profileUrl, chatId, text, proxyUrl, __attempt: __attempt + 1 });
    }

    const msg = String(err?.message || err || '');
    if (msg.toLowerCase().includes('operation failed')) {
      const wrapped = new Error(
        'LinkedIn UI transient failure while sending message. Please retry once with fresh cookies.'
      );
      wrapped.code = 'SEND_NOT_CONFIRMED';
      wrapped.status = 502;
      throw wrapped;
    }
    throw err;
  } finally {
    if (networkThreadProbe) {
      networkThreadProbe.stop();
    }
    if (page) await page.close().catch(() => {});
  }
}

async function sendMessageNew({ accountId, profileUrl, chatId, text, proxyUrl }) {
  return withAccountLock(accountId, async () =>
    sendMessageNewInternal({ accountId, profileUrl, chatId, text, proxyUrl, __attempt: 1 })
  );
}

module.exports = { sendMessageNew };

