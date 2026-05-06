'use strict';

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

module.exports = {
  isComposerDraftCleared,
  detectSendErrorBanner,
};
