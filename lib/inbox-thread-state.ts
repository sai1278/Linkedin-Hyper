import type { Conversation } from '@/types/dashboard';

export type ConversationIdentity = Pick<Conversation, 'accountId' | 'conversationId'>;

export type ThreadScrollState = {
  conversationKey: string;
  lastMessageKey: string;
  messageCount: number;
};

export function getConversationSelectionKey(conversation: ConversationIdentity | null | undefined): string {
  if (!conversation) {
    return '';
  }

  return `${String(conversation.accountId || '').trim()}::${String(conversation.conversationId || '').trim()}`;
}

export function shouldApplyThreadResponse(
  latestRequestToken: number,
  responseToken: number,
  activeConversationKey: string | null,
  responseConversationKey: string
): boolean {
  return latestRequestToken === responseToken && activeConversationKey === responseConversationKey;
}

export function getThreadAutoScrollBehavior(
  previousState: ThreadScrollState | null,
  nextState: ThreadScrollState,
  autoScrollEnabled: boolean
): 'auto' | 'smooth' | null {
  const conversationChanged = previousState?.conversationKey !== nextState.conversationKey;
  if (conversationChanged) {
    return 'auto';
  }

  const appendedNewTailMessage =
    nextState.messageCount > (previousState?.messageCount ?? 0) &&
    nextState.lastMessageKey !== (previousState?.lastMessageKey ?? '');

  if (!appendedNewTailMessage || !autoScrollEnabled) {
    return null;
  }

  return 'smooth';
}
