'use strict';

function normalizeThreadId(accountId, conversationId) {
  const raw = String(conversationId || '');
  const prefix = `${accountId}:`;
  if (raw.startsWith(prefix)) {
    return raw.slice(prefix.length);
  }
  return raw;
}

function isSyntheticPublicMessageId(value) {
  const id = String(value || '').trim();
  if (!id) return true;
  return (
    id.startsWith('opt-') ||
    id.startsWith('preview-') ||
    id.startsWith('live-') ||
    id.startsWith('sent-') ||
    id.startsWith('msg-')
  );
}

function getApiItemTimestamp(item) {
  const raw = item?.createdAt || item?.sentAt || 0;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isApiItemSentByMe(item) {
  return item?.senderId === '__self__' || item?.isSentByMe === true;
}

function getPublicMessageTimestampBucket(item, windowMs = 60 * 1000) {
  const timestamp = getApiItemTimestamp(item);
  return timestamp > 0 ? Math.floor(timestamp / windowMs) : 0;
}

function buildStablePublicMessageFallbackId(item, fallbackChatId = '', accountId = '') {
  return [
    'msg',
    String(accountId || ''),
    String(item?.chatId || fallbackChatId || ''),
    isApiItemSentByMe(item) ? '__self__' : String(item?.senderName || '').replace(/\s+/g, ' ').trim().toLowerCase(),
    String(item?.text || '').replace(/\s+/g, ' ').trim().toLowerCase(),
    String(getPublicMessageTimestampBucket(item)),
  ].join('|');
}

function getPublicMessageDedupKey(item, context = {}) {
  const stableId = String(item?.linkedinMessageId || item?.id || '').trim();
  if (stableId && !isSyntheticPublicMessageId(stableId)) {
    return `id:${stableId}`;
  }

  return [
    'fp',
    String(context.accountId || ''),
    String(context.conversationId || item?.chatId || ''),
    isApiItemSentByMe(item) ? '1' : '0',
    String(item?.senderName || '').replace(/\s+/g, ' ').trim().toLowerCase(),
    String(item?.text || '').replace(/\s+/g, ' ').trim().toLowerCase(),
    String(getPublicMessageTimestampBucket(item)),
  ].join('|');
}

function scorePublicMessageItem(item) {
  let score = 0;
  const stableId = String(item?.linkedinMessageId || item?.id || '').trim();
  if (stableId && !isSyntheticPublicMessageId(stableId)) score += 30;
  if (item?.createdAt) score += 10;
  if (String(item?.senderName || '').replace(/\s+/g, ' ').trim() && item?.senderName !== 'Unknown') score += 5;
  if (String(item?.text || '').replace(/\s+/g, ' ').trim()) score += 3;
  if (item?.chatId) score += 2;
  return score;
}

function preferPublicMessageItem(existing, candidate) {
  const preferred = scorePublicMessageItem(candidate) >= scorePublicMessageItem(existing) ? candidate : existing;
  const secondary = preferred === candidate ? existing : candidate;

  return {
    ...secondary,
    ...preferred,
    id: preferred?.id || secondary?.id,
    chatId: preferred?.chatId || secondary?.chatId,
    senderId: preferred?.senderId || secondary?.senderId,
    text: preferred?.text || secondary?.text || '',
    createdAt: preferred?.createdAt || secondary?.createdAt,
    sentAt: preferred?.sentAt || secondary?.sentAt || preferred?.createdAt || secondary?.createdAt,
    isSentByMe: preferred?.isSentByMe ?? secondary?.isSentByMe,
    senderName: preferred?.senderName || secondary?.senderName || 'Unknown',
    linkedinMessageId: preferred?.linkedinMessageId || secondary?.linkedinMessageId || null,
  };
}

function mergePublicMessages(existingItems, incomingItems, context = {}, label = 'mergePublicMessages') {
  const beforeCount = (existingItems?.length || 0) + (incomingItems?.length || 0);
  const merged = [];
  let duplicateSkippedCount = 0;

  for (const item of [...(existingItems || []), ...(incomingItems || [])]) {
    if (!item) continue;

    const normalizedItem = {
      ...item,
      text: String(item?.text || ''),
      senderName: item?.senderName || 'Unknown',
      sentAt: item?.sentAt || item?.createdAt,
    };
    const dedupKey = getPublicMessageDedupKey(normalizedItem, context);
    const existingIndex = merged.findIndex((current) => (
      getPublicMessageDedupKey(current, context) === dedupKey
    ));

    if (existingIndex >= 0) {
      duplicateSkippedCount += 1;
      merged[existingIndex] = preferPublicMessageItem(merged[existingIndex], normalizedItem);
      continue;
    }

    merged.push(normalizedItem);
  }

  const sorted = merged.sort((left, right) => getApiItemTimestamp(left) - getApiItemTimestamp(right));
  console.debug(
    `[InboxDedup][${label}] before=${beforeCount} after=${sorted.length} duplicatesSkipped=${duplicateSkippedCount}`
  );
  return sorted;
}

function mapDbMessagesToApiItems(messages) {
  return messages.map((msg) => {
    const createdAt = new Date(msg.sentAt).toISOString();
    const isSentByMe = Boolean(msg.isSentByMe);
    return {
      id: msg.linkedinMessageId || msg.id,
      chatId: msg.conversationId,
      senderId: isSentByMe ? '__self__' : (msg.senderId || 'other'),
      text: msg.text || '',
      createdAt,
      sentAt: createdAt,
      isSentByMe,
      senderName: msg.senderName || (isSentByMe ? msg.accountId : 'Unknown'),
      linkedinMessageId: msg.linkedinMessageId || null,
    };
  });
}

function mapLiveMessagesToApiItems(messages, fallbackChatId, accountId) {
  return (messages || []).map((msg) => {
    const createdAt = msg.createdAt || msg.sentAt || new Date().toISOString();
    const isSentByMe = msg.senderId === '__self__' || msg.isSentByMe === true;
    const normalizedItem = {
      ...msg,
      chatId: msg.chatId || fallbackChatId,
      senderId: isSentByMe ? '__self__' : (msg.senderId || 'other'),
      text: msg.text || '',
      createdAt,
      sentAt: createdAt,
      isSentByMe,
      senderName: msg.senderName || (isSentByMe ? accountId : 'Unknown'),
    };
    const stableFallbackId = buildStablePublicMessageFallbackId(normalizedItem, fallbackChatId, accountId);
    return {
      id: msg.linkedinMessageId || msg.id || stableFallbackId,
      chatId: normalizedItem.chatId,
      senderId: normalizedItem.senderId,
      text: normalizedItem.text,
      createdAt,
      sentAt: createdAt,
      isSentByMe,
      senderName: normalizedItem.senderName,
      linkedinMessageId: msg.linkedinMessageId || msg.id || stableFallbackId,
      hasExactTimestamp: msg.hasExactTimestamp === true,
      rawTimeLabel: msg.rawTimeLabel || '',
    };
  });
}

function mergeApiThreadItems(...itemSets) {
  return mergePublicMessages(itemSets[0] || [], itemSets.slice(1).flatMap((set) => set || []), {}, 'mergeApiThreadItems');
}

module.exports = {
  normalizeThreadId,
  mergePublicMessages,
  mapDbMessagesToApiItems,
  mapLiveMessagesToApiItems,
  mergeApiThreadItems,
  getApiItemTimestamp,
  isApiItemSentByMe,
};
