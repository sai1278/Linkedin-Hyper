'use strict';

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

module.exports = {
  COMPOSER_SELECTORS,
  MESSAGING_COMPOSE_TRIGGER_SELECTORS,
  MESSAGING_RECIPIENT_INPUT_SELECTORS,
  PROFILE_DIRECT_MESSAGE_SELECTORS,
  PROFILE_TOP_ACTION_SELECTORS,
  PROFILE_MORE_ACTION_SELECTORS,
  normalizeText,
  isGenericUiLabel,
  slugToName,
  deriveNameFromProfileUrl,
  normalizeParticipantName,
  normalizeProfileUrlForCompare,
  isAuthwallUrl,
  isMessagingSurfaceUrl,
  truncateForLog,
  summarizeSelectorCounts,
};
