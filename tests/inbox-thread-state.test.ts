import { describe, expect, it } from 'vitest';
import {
  buildThreadSignature,
  getConversationSelectionKey,
  getThreadScrollDecision,
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
