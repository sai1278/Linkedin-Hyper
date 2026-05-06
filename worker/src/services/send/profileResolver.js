'use strict';

const { delay } = require('../../humanBehavior');
const {
  PROFILE_DIRECT_MESSAGE_SELECTORS,
  PROFILE_TOP_ACTION_SELECTORS,
  PROFILE_MORE_ACTION_SELECTORS,
  normalizeText,
  deriveNameFromProfileUrl,
  normalizeProfileUrlForCompare,
} = require('./common');
const { captureFailureScreenshot, logSendStep } = require('./diagnostics');
const { waitForComposerOpen, clickVisibleSelector } = require('./browserSurfaceHelpers');

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
        return {
          clicked: true,
          matchedText: (candidate.textContent || '').trim() || candidate.getAttribute('aria-label') || '',
        };
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
        continue;
      }
      if (!overflowResult.clicked) {
        lastReason = overflowResult.label
          ? `Overflow menu did not expose an enabled Message action (${overflowResult.label}).`
          : 'Overflow menu opened but no Message action was found.';
        continue;
      }

      logSendStep(accountId, `message action clicked from overflow menu: ${overflowResult.label || 'Message'}`);
      if (await waitForComposerOpen(page, 7000)) {
        return { opened: true, strategy: 'overflow-menu', matched: overflowResult.label || 'Message' };
      }
      lastReason = `Overflow menu Message action clicked (${overflowResult.label || 'Message'}) but composer did not open.`;
      const shot = await captureFailureScreenshot(page, accountId, `composer-not-open-overflow-${attempt}`);
      if (shot) logSendStep(accountId, `composer not open after overflow click; screenshot: ${shot}`);
    }

    await delay(500, 1200);
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

module.exports = {
  clickMessageTriggerOnProfile,
  openComposerFromPeopleSearch,
};
