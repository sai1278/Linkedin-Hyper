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

function normalizeThreadValue(value: string | undefined | null): string {
  return String(value || '').trim();
}

function normalizeThreadText(value: string | undefined | null): string {
  return normalizeThreadValue(value).replace(/\s+/g, ' ');
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
