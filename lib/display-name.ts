function normalizeWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isGenericUiLabel(value: string): boolean {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) return true;

  if (/^\d+$/.test(normalized)) return true;
  if (/^\d+\s*(notification|notifications|message|messages)$/.test(normalized)) return true;

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

export function deriveDisplayName(name: string, profileUrl: string): string {
  const normalized = normalizeWhitespace(name);
  if (normalized && !isGenericUiLabel(normalized)) {
    return normalized;
  }

  const match = String(profileUrl || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!match?.[1]) return 'Unknown';

  const fromSlug = normalizeWhitespace(
    decodeURIComponent(match[1])
      .replace(/[-_]+/g, ' ')
      .replace(/\b\d+\b/g, '')
  );
  return fromSlug || 'Unknown';
}

