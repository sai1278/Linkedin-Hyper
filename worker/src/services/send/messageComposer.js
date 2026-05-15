'use strict';

const { delay, humanType } = require('../../humanBehavior');
const {
  MESSAGING_COMPOSE_TRIGGER_SELECTORS,
  MESSAGING_RECIPIENT_INPUT_SELECTORS,
  normalizeText,
  deriveNameFromProfileUrl,
  normalizeParticipantName,
  normalizeProfileUrlForCompare,
  slugToName,
} = require('./common');
const { captureFailureScreenshot, logSendStep } = require('./diagnostics');
const { waitForComposerOpen, gotoMessagingHomeLenient, clickVisibleSelector } = require('./browserSurfaceHelpers');

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

async function openComposerFromMessagingHome(page, { accountId, profileUrl, participantName }, helpers) {
  const {
    resolveThreadIdFromCurrentMessagingView,
    extractThreadIdFromText,
    isValidThreadId,
  } = helpers;
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
      const anchors = Array.from(document.querySelectorAll('a[href*=\"/in/\"]'));
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

module.exports = {
  openComposerFromMessagingHome,
};
