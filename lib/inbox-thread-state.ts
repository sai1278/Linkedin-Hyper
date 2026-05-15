import type { Conversation, Message } from '@/types/dashboard';

export type ConversationIdentity = Pick<Conversation, 'accountId' | 'conversationId'>;

export type ThreadSignature = {
  conversationKey: string;
  messageCount: number;
  firstMessageId: string;
  lastMessageId: string;
  lastMessageCreatedAt: number;
  tailSignature: string;
};

export type ThreadScrollDecision = {
  action: 'scroll-to-latest' | 'preserve-scroll';
  behavior: 'auto' | 'smooth' | null;
  reason:
    | 'initial-thread-load'
    | 'conversation-changed'
    | 'forced-scroll'
    | 'new-tail-while-near-bottom'
    | 'new-tail-while-user-away'
    | 'passive-refresh';
  trueTailAppend: boolean;
};

type ThreadMessageLike = Pick<Message, 'id' | 'text' | 'sentAt' | 'sentByMe' | 'senderName'>;
type ThreadMessageMetaLike = ThreadMessageLike & {
  status?: Message['status'];
  error?: Message['error'];
  source?: string | null;
  synthetic?: boolean | null;
  fallback?: boolean | null;
  syncedAt?: number | string | null;
  editedAt?: number | string | null;
};
type ThreadConversationLike = Pick<Conversation, 'conversationId' | 'messages' | 'lastMessage'>;

const STALE_OPTIMISTIC_TTL_MS = 5 * 60 * 1000;
const DEMO_MESSAGE_SUPPRESSION_MIN_AGE_MS = 10 * 60 * 1000;
const RECENT_THREAD_ACTIVITY_WINDOW_MS = 10 * 60 * 1000;
const RECENT_EDIT_WINDOW_MS = 10 * 60 * 1000;
const RECENT_SYNC_WINDOW_MS = 10 * 60 * 1000;
const DEMO_MESSAGE_TEXTS = new Set([
  'eyyyy',
  'heyyy',
  'how are you',
  'kk!',
  'okay',
  'okayyy',
  'text me',
]);

function normalizeThreadValue(value: string | undefined | null): string {
  return String(value || '').trim();
}

function normalizeThreadText(value: string | undefined | null): string {
  return normalizeThreadValue(value).replace(/\s+/g, ' ');
}

function getNumericTimestamp(value: number | string | undefined | null): number {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return numericValue;
  }

  const parsed = new Date(String(value || '')).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getThreadMessageSource(messageId: string | undefined | null):
  | 'optimistic'
  | 'preview'
  | 'activity-log'
  | 'live-fallback'
  | 'synthetic-fallback'
  | 'persisted' {
  const normalizedId = normalizeThreadValue(messageId).toLowerCase();

  if (!normalizedId) {
    return 'synthetic-fallback';
  }

  if (normalizedId.startsWith('opt-')) {
    return 'optimistic';
  }

  if (normalizedId.startsWith('preview-')) {
    return 'preview';
  }

  if (normalizedId.startsWith('activity-msg-')) {
    return 'activity-log';
  }

  if (normalizedId.startsWith('live-')) {
    return 'live-fallback';
  }

  if (
    normalizedId.startsWith('msg:') ||
    normalizedId.startsWith('msg|') ||
    normalizedId.startsWith('sent-')
  ) {
    return 'synthetic-fallback';
  }

  return 'persisted';
}

export function isSyntheticThreadMessageId(messageId: string | undefined | null): boolean {
  return getThreadMessageSource(messageId) !== 'persisted';
}

export function isKnownDemoMessageText(text: string | undefined | null): boolean {
  return DEMO_MESSAGE_TEXTS.has(normalizeThreadText(text).toLowerCase());
}

export function isConfirmedThreadMessage(message: ThreadMessageMetaLike | null | undefined): boolean {
  if (!message) {
    return false;
  }

  const explicitSource = normalizeThreadValue(message.source).toLowerCase();
  const explicitSynthetic = Boolean(message.synthetic || message.fallback);

  return (
    getThreadMessageSource(message.id) === 'persisted' &&
    !explicitSynthetic &&
    explicitSource !== 'activity-log' &&
    explicitSource !== 'optimistic' &&
    explicitSource !== 'fallback' &&
    explicitSource !== 'preview'
  );
}

export function isStaleOptimisticMessage(
  message: ThreadMessageMetaLike | null | undefined,
  now = Date.now()
): boolean {
  if (!message || !message.sentByMe) {
    return false;
  }

  return (
    getThreadMessageSource(message.id) === 'optimistic' &&
    now - getNumericTimestamp(message.sentAt) > STALE_OPTIMISTIC_TTL_MS
  );
}

export function isSyntheticDemoMessage(
  message: ThreadMessageMetaLike | null | undefined,
  now = Date.now()
): boolean {
  if (!message) {
    return false;
  }

  if (isStaleOptimisticMessage(message, now)) {
    return true;
  }

  if (!message.sentByMe || !isKnownDemoMessageText(message.text)) {
    return false;
  }

  const explicitSource = normalizeThreadValue(message.source).toLowerCase();
  const syntheticSource =
    getThreadMessageSource(message.id) !== 'persisted' ||
    explicitSource === 'activity-log' ||
    explicitSource === 'optimistic' ||
    explicitSource === 'fallback' ||
    explicitSource === 'preview' ||
    Boolean(message.synthetic || message.fallback);
  const olderThanSafeThreshold = now - getNumericTimestamp(message.sentAt) > DEMO_MESSAGE_SUPPRESSION_MIN_AGE_MS;

  return syntheticSource || !isConfirmedThreadMessage(message) || olderThanSafeThreshold;
}

export function isStableConversationThread(conversationId: string | undefined | null): boolean {
  const normalizedConversationId = normalizeThreadValue(conversationId).toLowerCase();
  return Boolean(normalizedConversationId)
    && !normalizedConversationId.startsWith('activity-')
    && !normalizedConversationId.startsWith('fallback-');
}

function isPendingThreadMessage(message: ThreadMessageMetaLike | null | undefined): boolean {
  if (!message) {
    return false;
  }

  const source = getThreadMessageSource(message.id);
  if (source === 'optimistic') {
    return true;
  }

  return message.status === 'sending';
}

function isFailedThreadMessage(message: ThreadMessageMetaLike | null | undefined): boolean {
  return message?.status === 'failed';
}

function getLatestOutgoingMessage(
  messages: ThreadMessageMetaLike[] | null | undefined
): ThreadMessageMetaLike | null {
  const normalizedMessages = Array.isArray(messages) ? messages : [];
  let latest: ThreadMessageMetaLike | null = null;

  for (const message of normalizedMessages) {
    if (!message?.sentByMe) {
      continue;
    }

    if (!latest || getNumericTimestamp(message.sentAt) >= getNumericTimestamp(latest.sentAt)) {
      latest = message;
    }
  }

  return latest;
}

function isSameThreadMessage(
  left: ThreadMessageMetaLike | null | undefined,
  right: ThreadMessageMetaLike | null | undefined
): boolean {
  if (!left || !right) {
    return false;
  }

  const leftId = normalizeThreadValue(left.id);
  const rightId = normalizeThreadValue(right.id);
  if (leftId && rightId) {
    return leftId === rightId;
  }

  return (
    normalizeThreadText(left.text).toLowerCase() === normalizeThreadText(right.text).toLowerCase() &&
    getNumericTimestamp(left.sentAt) === getNumericTimestamp(right.sentAt) &&
    Boolean(left.sentByMe) === Boolean(right.sentByMe)
  );
}

function getLatestThreadActivityAt(
  conversation: ThreadConversationLike | null | undefined,
  messages: ThreadMessageMetaLike[] | null | undefined
): number {
  const normalizedMessages = Array.isArray(messages) ? messages : [];
  let latest = getNumericTimestamp(conversation?.lastMessage?.sentAt);

  for (const message of normalizedMessages) {
    const timestamp = getNumericTimestamp(message?.sentAt);
    if (timestamp > latest) {
      latest = timestamp;
    }
  }

  return latest;
}

function isRecentlySyncedThreadMessage(
  message: ThreadMessageMetaLike | null | undefined,
  now = Date.now()
): boolean {
  if (!message) {
    return false;
  }

  const syncedAt = getNumericTimestamp(message.syncedAt);
  return syncedAt > 0 && now - syncedAt <= RECENT_SYNC_WINDOW_MS;
}

function isRecentlyEditedThreadMessage(
  message: ThreadMessageMetaLike | null | undefined,
  now = Date.now()
): boolean {
  if (!message) {
    return false;
  }

  const editedAt = getNumericTimestamp(message.editedAt);
  return editedAt > 0 && now - editedAt <= RECENT_EDIT_WINDOW_MS;
}

function getDemoSuppressionDecision(
  message: ThreadMessageMetaLike | null | undefined,
  conversation: ThreadConversationLike | null | undefined,
  now = Date.now()
): {
  suppress: boolean;
  reason: string;
  ageMs: number;
  source: ReturnType<typeof getThreadMessageSource>;
} {
  const source = getThreadMessageSource(message?.id);
  const sentAt = getNumericTimestamp(message?.sentAt);
  const ageMs = sentAt > 0 ? Math.max(0, now - sentAt) : Number.POSITIVE_INFINITY;

  if (!message) {
    return { suppress: false, reason: 'missing-message', ageMs: 0, source };
  }

  if (!message.sentByMe) {
    return { suppress: false, reason: 'incoming-message', ageMs, source };
  }

  if (!isKnownDemoMessageText(message.text)) {
    return { suppress: false, reason: 'non-demo-text', ageMs, source };
  }

  if (isPendingThreadMessage(message)) {
    return { suppress: false, reason: 'pending-message', ageMs, source };
  }

  if (isFailedThreadMessage(message)) {
    return { suppress: false, reason: 'failed-message', ageMs, source };
  }

  const latestOutgoing = getLatestOutgoingMessage(conversation?.messages);
  if (isSameThreadMessage(latestOutgoing, message)) {
    return { suppress: false, reason: 'latest-outgoing-message', ageMs, source };
  }

  if (isRecentlyEditedThreadMessage(message, now)) {
    return { suppress: false, reason: 'recently-edited', ageMs, source };
  }

  if (isRecentlySyncedThreadMessage(message, now)) {
    return { suppress: false, reason: 'recently-synced', ageMs, source };
  }

  const latestThreadActivityAt = getLatestThreadActivityAt(conversation, conversation?.messages);
  const hasRecentThreadActivity =
    latestThreadActivityAt > 0 && now - latestThreadActivityAt <= RECENT_THREAD_ACTIVITY_WINDOW_MS;

  if (
    isConfirmedThreadMessage(message) &&
    ageMs <= DEMO_MESSAGE_SUPPRESSION_MIN_AGE_MS &&
    hasRecentThreadActivity
  ) {
    return { suppress: false, reason: 'recent-confirmed-message', ageMs, source };
  }

  if (ageMs <= DEMO_MESSAGE_SUPPRESSION_MIN_AGE_MS) {
    return { suppress: false, reason: 'too-recent', ageMs, source };
  }

  return {
    suppress: true,
    reason: source === 'persisted' ? 'stale-demo-message' : 'stale-demo-synthetic-message',
    ageMs,
    source,
  };
}

export function shouldSuppressDemoMessage(
  message: ThreadMessageMetaLike | null | undefined,
  conversation: ThreadConversationLike | null | undefined,
  now = Date.now()
): boolean {
  return getDemoSuppressionDecision(message, conversation, now).suppress;
}

export function sanitizeThreadMessagesForConversation<T extends ThreadMessageMetaLike>(
  conversationId: string | undefined | null,
  messages: T[] | null | undefined,
  now = Date.now()
): T[] {
  const normalizedMessages = Array.isArray(messages) ? messages : [];
  const stableConversation = isStableConversationThread(conversationId);

  return normalizedMessages.filter((message) => {
    if (!message) {
      return false;
    }

    if (isStaleOptimisticMessage(message, now)) {
      return false;
    }

    if (stableConversation && getThreadMessageSource(message.id) === 'activity-log') {
      return false;
    }

    if (stableConversation && isSyntheticDemoMessage(message, now)) {
      return false;
    }

    return true;
  });
}

export function sanitizeConversationMessages<T extends ThreadMessageMetaLike>(
  conversation: ThreadConversationLike | null | undefined,
  messages: T[] | null | undefined = conversation?.messages as T[] | null | undefined,
  now = Date.now()
): T[] {
  const normalizedMessages = sanitizeThreadMessagesForConversation(
    conversation?.conversationId,
    messages,
    now
  );
  const stableConversation = isStableConversationThread(conversation?.conversationId);

  return normalizedMessages.filter((message) => {
    if (!stableConversation) {
      return true;
    }

    const decision = getDemoSuppressionDecision(message, {
      conversationId: conversation?.conversationId || '',
      lastMessage: conversation?.lastMessage || { text: '', sentAt: 0, sentByMe: false },
      messages: normalizedMessages,
    }, now);

    if (decision.suppress && process.env.NODE_ENV !== 'production') {
      console.debug('[Inbox][DemoSuppress]', {
        messageId: message.id,
        reason: decision.reason,
        ageMs: decision.ageMs,
        source: decision.source,
      });
    }

    return !decision.suppress;
  });
}

export function filterThreadMessagesForConversation<T extends ThreadMessageMetaLike>(
  conversationId: string | undefined | null,
  messages: T[] | null | undefined,
  now = Date.now()
): T[] {
  return sanitizeConversationMessages({
    conversationId: conversationId || '',
    messages: Array.isArray(messages) ? messages : [],
    lastMessage: {
      text: '',
      sentAt: 0,
      sentByMe: false,
    },
  }, messages, now);
}

function getStableThreadMessageId(message: ThreadMessageLike | null | undefined): string {
  const stableId = normalizeThreadValue(message?.id);
  if (stableId) {
    return stableId;
  }

  if (!message) {
    return '';
  }

  return [
    message.sentByMe ? '__self__' : normalizeThreadText(message.senderName).toLowerCase() || 'unknown',
    normalizeThreadText(message.text).toLowerCase(),
    String(Number(message.sentAt) || 0),
  ].join(':');
}

function getTailSignature(message: ThreadMessageLike | null | undefined): string {
  if (!message) {
    return '';
  }

  return [
    getStableThreadMessageId(message),
    normalizeThreadText(message.text).toLowerCase(),
    String(Number(message.sentAt) || 0),
  ].join('|');
}

function getMessageRenderSignature(message: ThreadMessageLike | null | undefined): string {
  if (!message) {
    return '';
  }

  return [
    getStableThreadMessageId(message),
    normalizeThreadText(message.text).toLowerCase(),
    String(Number(message.sentAt) || 0),
    message.sentByMe ? '1' : '0',
    normalizeThreadText(message.senderName).toLowerCase(),
  ].join('|');
}

export function getConversationSelectionKey(conversation: ConversationIdentity | null | undefined): string {
  if (!conversation) {
    return '';
  }

  return `${normalizeThreadValue(conversation.accountId)}::${normalizeThreadValue(conversation.conversationId)}`;
}

export function buildThreadSignature(
  conversationKey: string,
  messages: ThreadMessageLike[] | null | undefined
): ThreadSignature {
  const normalizedMessages = Array.isArray(messages) ? messages : [];
  const firstMessage = normalizedMessages[0];
  const lastMessage = normalizedMessages[normalizedMessages.length - 1];

  return {
    conversationKey,
    messageCount: normalizedMessages.length,
    firstMessageId: getStableThreadMessageId(firstMessage),
    lastMessageId: getStableThreadMessageId(lastMessage),
    lastMessageCreatedAt: Number(lastMessage?.sentAt) || 0,
    tailSignature: getTailSignature(lastMessage),
  };
}

export function areThreadMessagesEquivalent(
  previousMessages: ThreadMessageLike[] | null | undefined,
  nextMessages: ThreadMessageLike[] | null | undefined
): boolean {
  const previous = Array.isArray(previousMessages) ? previousMessages : [];
  const next = Array.isArray(nextMessages) ? nextMessages : [];

  if (previous.length !== next.length) {
    return false;
  }

  for (let index = 0; index < previous.length; index += 1) {
    if (getMessageRenderSignature(previous[index]) !== getMessageRenderSignature(next[index])) {
      return false;
    }
  }

  return true;
}

export function isTrueTailAppend(
  previousSignature: ThreadSignature | null,
  nextSignature: ThreadSignature
): boolean {
  if (!previousSignature) {
    return false;
  }

  return (
    previousSignature.conversationKey === nextSignature.conversationKey &&
    previousSignature.lastMessageId !== '' &&
    nextSignature.lastMessageId !== previousSignature.lastMessageId &&
    nextSignature.messageCount > previousSignature.messageCount &&
    nextSignature.lastMessageCreatedAt >= previousSignature.lastMessageCreatedAt
  );
}

export function getThreadScrollDecision({
  previousSignature,
  nextSignature,
  userHasManuallyScrolled,
  isNearBottom,
  forceScrollToLatest = false,
}: {
  previousSignature: ThreadSignature | null;
  nextSignature: ThreadSignature;
  userHasManuallyScrolled: boolean;
  isNearBottom: boolean;
  forceScrollToLatest?: boolean;
}): ThreadScrollDecision {
  if (forceScrollToLatest) {
    return {
      action: 'scroll-to-latest',
      behavior: 'smooth',
      reason: 'forced-scroll',
      trueTailAppend: false,
    };
  }

  if (!previousSignature) {
    return {
      action: 'scroll-to-latest',
      behavior: 'auto',
      reason: 'initial-thread-load',
      trueTailAppend: false,
    };
  }

  if (previousSignature.conversationKey !== nextSignature.conversationKey) {
    return {
      action: 'scroll-to-latest',
      behavior: 'auto',
      reason: 'conversation-changed',
      trueTailAppend: false,
    };
  }

  const trueTailAppend = isTrueTailAppend(previousSignature, nextSignature);
  if (trueTailAppend && isNearBottom && !userHasManuallyScrolled) {
    return {
      action: 'scroll-to-latest',
      behavior: 'smooth',
      reason: 'new-tail-while-near-bottom',
      trueTailAppend,
    };
  }

  return {
    action: 'preserve-scroll',
    behavior: null,
    reason: trueTailAppend ? 'new-tail-while-user-away' : 'passive-refresh',
    trueTailAppend,
  };
}

export function shouldShowJumpToLatest(
  userHasManuallyScrolled: boolean,
  isNearBottom: boolean
): boolean {
  return userHasManuallyScrolled && !isNearBottom;
}

export function shouldApplyThreadResponse(
  latestRequestToken: number,
  responseToken: number,
  activeConversationKey: string | null,
  responseConversationKey: string
): boolean {
  return latestRequestToken === responseToken && activeConversationKey === responseConversationKey;
}
