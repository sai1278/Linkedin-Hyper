import { describe, expect, it } from 'vitest';
import {
  getConversationSelectionKey,
  getThreadAutoScrollBehavior,
  shouldApplyThreadResponse,
} from '@/lib/inbox-thread-state';

describe('inbox thread state helpers', () => {
  it('builds a stable selection key from account and conversation ids', () => {
    expect(getConversationSelectionKey({ accountId: 'acct-1', conversationId: 'conv-2' })).toBe('acct-1::conv-2');
  });

  it('ignores stale thread responses when request token or active thread mismatch', () => {
    expect(shouldApplyThreadResponse(5, 5, 'acct-1::conv-2', 'acct-1::conv-2')).toBe(true);
    expect(shouldApplyThreadResponse(5, 4, 'acct-1::conv-2', 'acct-1::conv-2')).toBe(false);
    expect(shouldApplyThreadResponse(5, 5, 'acct-1::conv-3', 'acct-1::conv-2')).toBe(false);
  });

  it('does not auto-scroll when the same last message remains after a background update', () => {
    expect(
      getThreadAutoScrollBehavior(
        { conversationKey: 'acct-1::conv-2', lastMessageKey: 'msg-5', messageCount: 10 },
        { conversationKey: 'acct-1::conv-2', lastMessageKey: 'msg-5', messageCount: 10 },
        true
      )
    ).toBeNull();

    expect(
      getThreadAutoScrollBehavior(
        { conversationKey: 'acct-1::conv-2', lastMessageKey: 'msg-5', messageCount: 10 },
        { conversationKey: 'acct-1::conv-2', lastMessageKey: 'msg-5', messageCount: 11 },
        true
      )
    ).toBeNull();
  });

  it('scrolls only for conversation changes or true new tail messages', () => {
    expect(
      getThreadAutoScrollBehavior(
        { conversationKey: 'acct-1::conv-1', lastMessageKey: 'msg-1', messageCount: 4 },
        { conversationKey: 'acct-1::conv-2', lastMessageKey: '', messageCount: 0 },
        true
      )
    ).toBe('auto');

    expect(
      getThreadAutoScrollBehavior(
        { conversationKey: 'acct-1::conv-2', lastMessageKey: 'msg-5', messageCount: 10 },
        { conversationKey: 'acct-1::conv-2', lastMessageKey: 'msg-6', messageCount: 11 },
        true
      )
    ).toBe('smooth');
  });
});
