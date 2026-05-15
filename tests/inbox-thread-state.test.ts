import { describe, expect, it } from 'vitest';
import {
  areThreadMessagesEquivalent,
  buildThreadSignature,
  filterThreadMessagesForConversation,
  getConversationSelectionKey,
  isConfirmedThreadMessage,
  isKnownDemoMessageText,
  isStaleOptimisticMessage,
  isSyntheticDemoMessage,
  getThreadMessageSource,
  getThreadScrollDecision,
  sanitizeThreadMessagesForConversation,
  isSyntheticThreadMessageId,
  shouldApplyThreadResponse,
  shouldShowJumpToLatest,
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

  it('treats same-thread passive refreshes with identical messages as equivalent', () => {
    const first = [
      { id: 'msg-1', text: 'hello', sentAt: 1000, sentByMe: false, senderName: 'Alex' },
      { id: 'msg-2', text: 'there', sentAt: 2000, sentByMe: true, senderName: 'Me' },
    ];
    const second = [
      { id: 'msg-1', text: 'hello', sentAt: 1000, sentByMe: false, senderName: 'Alex' },
      { id: 'msg-2', text: 'there', sentAt: 2000, sentByMe: true, senderName: 'Me' },
    ];

    expect(areThreadMessagesEquivalent(first, second)).toBe(true);
  });

  it('classifies activity preview messages as synthetic activity-log rows', () => {
    expect(getThreadMessageSource('activity-msg-1712345678')).toBe('activity-log');
    expect(isSyntheticThreadMessageId('activity-msg-1712345678')).toBe(true);
    expect(isSyntheticThreadMessageId('real-linkedin-message-id')).toBe(false);
  });

  it('recognizes the known demo/test message texts', () => {
    expect(isKnownDemoMessageText('okay')).toBe(true);
    expect(isKnownDemoMessageText(' OKAYYY ')).toBe(true);
    expect(isKnownDemoMessageText('a real production message')).toBe(false);
  });

  it('drops activity preview rows when rendering a stable conversation thread', () => {
    const messages = [
      { id: 'activity-msg-1', text: 'okay', sentAt: 1000, sentByMe: true, senderName: 'acct-1' },
      { id: 'msg-2', text: 'real reply', sentAt: 2000, sentByMe: false, senderName: 'Alex' },
    ];

    expect(filterThreadMessagesForConversation('real-thread-123', messages)).toEqual([
      { id: 'msg-2', text: 'real reply', sentAt: 2000, sentByMe: false, senderName: 'Alex' },
    ]);
  });

  it('keeps activity preview rows for activity-only fallback conversations', () => {
    const messages = [
      { id: 'activity-msg-1', text: 'okay', sentAt: 1000, sentByMe: true, senderName: 'acct-1' },
    ];

    expect(filterThreadMessagesForConversation('activity-abc123', messages)).toEqual(messages);
  });

  it('removes stale optimistic rows automatically during thread sanitization', () => {
    const now = 10 * 60 * 1000;
    const messages = [
      { id: 'opt-1', text: 'still pending', sentAt: now - (6 * 60 * 1000), sentByMe: true, senderName: 'acct-1', status: 'sending' as const },
      { id: 'msg-2', text: 'confirmed', sentAt: now - 1000, sentByMe: false, senderName: 'Alex' },
    ];

    expect(isStaleOptimisticMessage(messages[0], now)).toBe(true);
    expect(sanitizeThreadMessagesForConversation('real-thread-123', messages, now)).toEqual([
      { id: 'msg-2', text: 'confirmed', sentAt: now - 1000, sentByMe: false, senderName: 'Alex' },
    ]);
  });

  it('filters synthetic demo rows but preserves confirmed persisted messages', () => {
    const now = Date.UTC(2026, 4, 15);
    const syntheticDemo = {
      id: 'activity-msg-1',
      text: 'okay',
      sentAt: now - 1000,
      sentByMe: true,
      senderName: 'acct-1',
      source: 'activity-log',
    };
    const confirmedMessage = {
      id: 'linkedin-123',
      text: 'okay',
      sentAt: now - 1000,
      sentByMe: true,
      senderName: 'acct-1',
    };

    expect(isSyntheticDemoMessage(syntheticDemo, now)).toBe(true);
    expect(isConfirmedThreadMessage(confirmedMessage)).toBe(true);
    expect(isSyntheticDemoMessage(confirmedMessage, now)).toBe(false);
    expect(sanitizeThreadMessagesForConversation('real-thread-123', [syntheticDemo, confirmedMessage], now)).toEqual([
      confirmedMessage,
    ]);
  });

  it('treats reconnect-like same-thread refreshes with changed message bodies as different', () => {
    const first = [
      { id: 'msg-1', text: 'hello', sentAt: 1000, sentByMe: false, senderName: 'Alex' },
      { id: 'msg-2', text: 'there', sentAt: 2000, sentByMe: true, senderName: 'Me' },
    ];
    const second = [
      { id: 'msg-1', text: 'hello', sentAt: 1000, sentByMe: false, senderName: 'Alex' },
      { id: 'msg-2', text: 'there!', sentAt: 2000, sentByMe: true, senderName: 'Me' },
    ];

    expect(areThreadMessagesEquivalent(first, second)).toBe(false);
  });

  it('does not auto-scroll on passive refresh when the tail is unchanged', () => {
    const previousSignature = buildThreadSignature('acct-1::conv-2', [
      { id: 'msg-1', text: 'hello', sentAt: 1000, sentByMe: false, senderName: 'Alex' },
      { id: 'msg-5', text: 'latest', sentAt: 5000, sentByMe: true, senderName: 'Me' },
    ]);
    const nextSignature = buildThreadSignature('acct-1::conv-2', [
      { id: 'msg-1', text: 'hello', sentAt: 1000, sentByMe: false, senderName: 'Alex' },
      { id: 'msg-5', text: 'latest', sentAt: 5000, sentByMe: true, senderName: 'Me' },
    ]);

    expect(
      getThreadScrollDecision({
        previousSignature,
        nextSignature,
        userHasManuallyScrolled: false,
        isNearBottom: true,
      })
    ).toEqual({
      action: 'preserve-scroll',
      behavior: null,
      reason: 'passive-refresh',
      trueTailAppend: false,
    });
  });

  it('does not auto-scroll on reconnect-style refresh when the active thread content is unchanged', () => {
    const previousSignature = buildThreadSignature('acct-1::conv-2', [
      { id: 'msg-1', text: 'hello', sentAt: 1000, sentByMe: false, senderName: 'Alex' },
      { id: 'msg-5', text: 'latest', sentAt: 5000, sentByMe: true, senderName: 'Me' },
    ]);
    const nextSignature = buildThreadSignature('acct-1::conv-2', [
      { id: 'msg-1', text: 'hello', sentAt: 1000, sentByMe: false, senderName: 'Alex' },
      { id: 'msg-5', text: 'latest', sentAt: 5000, sentByMe: true, senderName: 'Me' },
    ]);

    expect(
      getThreadScrollDecision({
        previousSignature,
        nextSignature,
        userHasManuallyScrolled: false,
        isNearBottom: false,
      })
    ).toEqual({
      action: 'preserve-scroll',
      behavior: null,
      reason: 'passive-refresh',
      trueTailAppend: false,
    });
  });

  it('preserves scroll when the same conversation is refreshed with a replaced array', () => {
    const previousSignature = buildThreadSignature('acct-1::conv-2', [
      { id: 'msg-1', text: 'first', sentAt: 1000, sentByMe: false, senderName: 'Alex' },
      { id: 'msg-3', text: 'third', sentAt: 3000, sentByMe: true, senderName: 'Me' },
    ]);
    const nextSignature = buildThreadSignature('acct-1::conv-2', [
      { id: 'msg-1', text: 'first', sentAt: 1000, sentByMe: false, senderName: 'Alex' },
      { id: 'msg-2', text: 'second', sentAt: 2000, sentByMe: false, senderName: 'Alex' },
      { id: 'msg-3', text: 'third', sentAt: 3000, sentByMe: true, senderName: 'Me' },
    ]);

    expect(
      getThreadScrollDecision({
        previousSignature,
        nextSignature,
        userHasManuallyScrolled: false,
        isNearBottom: false,
      })
    ).toEqual({
      action: 'preserve-scroll',
      behavior: null,
      reason: 'passive-refresh',
      trueTailAppend: false,
    });
  });

  it('auto-scrolls when a true tail message arrives and the user is near the bottom', () => {
    const previousSignature = buildThreadSignature('acct-1::conv-2', [
      { id: 'msg-5', text: 'latest', sentAt: 5000, sentByMe: true, senderName: 'Me' },
    ]);
    const nextSignature = buildThreadSignature('acct-1::conv-2', [
      { id: 'msg-5', text: 'latest', sentAt: 5000, sentByMe: true, senderName: 'Me' },
      { id: 'msg-6', text: 'new tail', sentAt: 6000, sentByMe: false, senderName: 'Alex' },
    ]);

    expect(
      getThreadScrollDecision({
        previousSignature,
        nextSignature,
        userHasManuallyScrolled: false,
        isNearBottom: true,
      })
    ).toEqual({
      action: 'scroll-to-latest',
      behavior: 'smooth',
      reason: 'new-tail-while-near-bottom',
      trueTailAppend: true,
    });
  });

  it('does not auto-scroll when a true tail message arrives but the user has scrolled up', () => {
    const previousSignature = buildThreadSignature('acct-1::conv-2', [
      { id: 'msg-5', text: 'latest', sentAt: 5000, sentByMe: true, senderName: 'Me' },
    ]);
    const nextSignature = buildThreadSignature('acct-1::conv-2', [
      { id: 'msg-5', text: 'latest', sentAt: 5000, sentByMe: true, senderName: 'Me' },
      { id: 'msg-6', text: 'new tail', sentAt: 6000, sentByMe: false, senderName: 'Alex' },
    ]);

    expect(
      getThreadScrollDecision({
        previousSignature,
        nextSignature,
        userHasManuallyScrolled: true,
        isNearBottom: false,
      })
    ).toEqual({
      action: 'preserve-scroll',
      behavior: null,
      reason: 'new-tail-while-user-away',
      trueTailAppend: true,
    });
  });

  it('allows initial scroll to latest when a new conversation is confirmed', () => {
    const nextSignature = buildThreadSignature('acct-1::conv-2', [
      { id: 'msg-7', text: 'loaded', sentAt: 7000, sentByMe: false, senderName: 'Alex' },
    ]);

    expect(
      getThreadScrollDecision({
        previousSignature: null,
        nextSignature,
        userHasManuallyScrolled: false,
        isNearBottom: true,
      })
    ).toEqual({
      action: 'scroll-to-latest',
      behavior: 'auto',
      reason: 'initial-thread-load',
      trueTailAppend: false,
    });
  });

  it('shows jump-to-latest only after the user manually scrolls away from bottom', () => {
    expect(shouldShowJumpToLatest(false, true)).toBe(false);
    expect(shouldShowJumpToLatest(false, false)).toBe(false);
    expect(shouldShowJumpToLatest(true, true)).toBe(false);
    expect(shouldShowJumpToLatest(true, false)).toBe(true);
  });
});
