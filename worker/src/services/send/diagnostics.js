'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('../../utils/logger');
const { truncateForLog, summarizeSelectorCounts } = require('./common');

const DEBUG_SCREENSHOT_DIR =
  process.env.LI_DEBUG_SCREENSHOT_DIR || '/tmp/linkedin-hyper-debug';
const PROFILE_DEBUG_ENABLED = process.env.LI_PROFILE_DEBUG !== '0';

function safeName(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown';
}

function logSendStep(accountId, message, fields) {
  logger.info('send_message.step', {
    accountId,
    detail: String(message || ''),
    ...fields,
  });
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

async function captureFailureScreenshot(page, accountId, label) {
  try {
    if (!page || page.isClosed?.()) return null;
    ensureDebugDir();
    const filename = `${safeName(accountId)}-${Date.now()}-${safeName(label)}.png`;
    const filePath = path.join(DEBUG_SCREENSHOT_DIR, filename);
    await page.screenshot({ path: filePath, fullPage: true });
    logger.warn('send_message.screenshot_saved', { accountId, screenshotPath: filePath, label });
    return filePath;
  } catch (err) {
    logger.warn('send_message.screenshot_failed', {
      accountId,
      label,
      error: err,
    });
    return null;
  }
}

module.exports = {
  DEBUG_SCREENSHOT_DIR,
  logSendStep,
  collectProfileActionDebugSnapshot,
  logProfileActionDebug,
  captureFailureScreenshot,
};
