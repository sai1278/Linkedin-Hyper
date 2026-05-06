import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

function loadRateLimitModule() {
  const modulePath = require.resolve('../worker/src/rateLimit.js');
  delete require.cache[modulePath];
  return require(modulePath) as {
    checkAndIncrement: (accountId: string, action: string) => Promise<unknown>;
  };
}

describe('rate limit logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.DISABLE_REDIS = '1';
    process.env.RATE_LIMIT_MESSAGES_SENT = '2';
    process.env.RATE_LIMIT_MESSAGES_SENT_HOURLY = '5';
    process.env.RATE_LIMIT_MESSAGES_SENT_MIN_GAP_SEC = '1';
    process.env.RATE_LIMIT_MESSAGES_SENT_BURST_LIMIT = '5';
    process.env.RATE_LIMIT_MESSAGES_SENT_BURST_WINDOW_SEC = '60';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enforces cooldown between consecutive sends', async () => {
    vi.setSystemTime(new Date('2026-05-01T00:00:00.000Z'));
    const rateLimit = loadRateLimitModule();

    await rateLimit.checkAndIncrement('acct-cooldown', 'messagesSent');

    await expect(
      rateLimit.checkAndIncrement('acct-cooldown', 'messagesSent')
    ).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
      status: 429,
    });
  });

  it('enforces the daily send cap after spaced sends', async () => {
    const rateLimit = loadRateLimitModule();

    vi.setSystemTime(new Date('2026-05-01T00:00:00.000Z'));
    await rateLimit.checkAndIncrement('acct-daily', 'messagesSent');

    vi.setSystemTime(new Date('2026-05-01T00:00:02.000Z'));
    await rateLimit.checkAndIncrement('acct-daily', 'messagesSent');

    vi.setSystemTime(new Date('2026-05-01T00:00:04.000Z'));
    await expect(
      rateLimit.checkAndIncrement('acct-daily', 'messagesSent')
    ).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
      status: 429,
    });
  });
});
