'use strict';

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isGenericUiLabel(value) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) return true;

  if (/^\d+$/.test(normalized)) return true;
  if (/^\d+\s*(notification|notifications|message|messages)(\s+total)?$/.test(normalized)) return true;
  if (/^(notification|notifications|message|messages)\s+total$/.test(normalized)) return true;

  const blocked = [
    'unknown',
    'inbox',
    'message',
    'messaging',
    'messages',
    'activity',
    'notifications',
    'notifications total',
    'linkedin member',
    'member',
    'conversation',
    'view profile',
    'loading',
    'linkedin',
    'feed',
    'search',
  ];
  return blocked.includes(normalized);
}

function deriveNameFromProfileUrl(profileUrl) {
  const match = String(profileUrl || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match?.[1]) return '';

  return normalizeWhitespace(
    decodeURIComponent(match[1])
      .replace(/[-_]+/g, ' ')
      .replace(/\b\d+\b/g, '')
  );
}

function normalizeParticipantName(name, profileUrl) {
  const parsedName = normalizeWhitespace(name);
  if (parsedName && !isGenericUiLabel(parsedName)) {
    return parsedName;
  }
  return deriveNameFromProfileUrl(profileUrl) || 'Unknown';
}

function normalizeProfileUrlForCompare(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    parsed.hash = '';
    parsed.search = '';
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = normalizedPath || '/';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return String(url || '').trim().replace(/\/+$/, '');
  }
}

function normalizeActivityToken(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function buildActivityDedupKey(entry) {
  const profileUrl = normalizeProfileUrlForCompare(entry?.targetProfileUrl || '');
  const participantName = normalizeParticipantName(entry?.targetName, profileUrl);
  const targetIdentity = profileUrl || normalizeActivityToken(participantName);
  const messageIdentity = normalizeActivityToken(entry?.message || entry?.textPreview || '');
  return [
    normalizeActivityToken(entry?.type || 'activity'),
    normalizeActivityToken(entry?.accountId || ''),
    targetIdentity,
    messageIdentity,
  ].join('|');
}

function dedupeRecentActivity(entries, windowMs = 10 * 60 * 1000) {
  const sorted = [...(entries || [])].sort(
    (a, b) => (Number(b?.timestamp) || 0) - (Number(a?.timestamp) || 0)
  );

  const latestSeenByKey = new Map();
  const deduped = [];

  for (const entry of sorted) {
    const timestamp = Number(entry?.timestamp) || 0;
    const key = buildActivityDedupKey(entry);
    const previousTs = latestSeenByKey.get(key);

    if (typeof previousTs === 'number' && previousTs - timestamp <= windowMs) {
      continue;
    }

    latestSeenByKey.set(key, timestamp);
    deduped.push(entry);
  }

  return deduped;
}

async function getRecentActivityEntries(getRedis, accountId, limit = 500) {
  const redis = getRedis();

  try {
    const rows = await redis.lrange(`activity:log:${accountId}`, 0, limit);
    return rows
      .map((raw) => {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = {
  normalizeWhitespace,
  isGenericUiLabel,
  normalizeParticipantName,
  normalizeProfileUrlForCompare,
  normalizeActivityToken,
  dedupeRecentActivity,
  getRecentActivityEntries,
};
