'use strict';

const counters = new Map();
const gauges = new Map();
const hourlyCounters = new Map();

function getHourBucketKey(timestampMs = Date.now()) {
  return new Date(timestampMs).toISOString().slice(0, 13);
}

function incrementCounter(name, amount = 1) {
  counters.set(name, (counters.get(name) || 0) + amount);
}

function incrementHourlyCounter(name, amount = 1, timestampMs = Date.now()) {
  const bucketKey = getHourBucketKey(timestampMs);
  const metricBuckets = hourlyCounters.get(name) || new Map();
  metricBuckets.set(bucketKey, (metricBuckets.get(bucketKey) || 0) + amount);

  const minimumAllowedKey = getHourBucketKey(Date.now() - (24 * 60 * 60 * 1000));
  for (const key of metricBuckets.keys()) {
    if (key < minimumAllowedKey) {
      metricBuckets.delete(key);
    }
  }

  hourlyCounters.set(name, metricBuckets);
}

function setGauge(name, value) {
  gauges.set(name, value);
}

function getCounter(name) {
  return counters.get(name) || 0;
}

function getGauge(name) {
  return gauges.get(name) || 0;
}

function getHourlySeries(name) {
  const metricBuckets = hourlyCounters.get(name) || new Map();
  return Array.from(metricBuckets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([hour, value]) => ({ hour, value }));
}

function recordMessageSent(accountId) {
  incrementCounter('messagesSent.total');
  incrementHourlyCounter('messagesSent.hourly');
  incrementCounter(`messagesSent.byAccount.${accountId}`);
}

function recordSendFailure(accountId, errorCode = 'UNKNOWN') {
  incrementCounter('messagesSent.failed');
  incrementHourlyCounter('messagesSent.failedHourly');
  incrementCounter(`messagesSent.failed.byAccount.${accountId}`);
  incrementCounter(`messagesSent.failed.byCode.${errorCode}`);
}

function recordSessionExpired(accountId, errorCode = 'SESSION_EXPIRED') {
  incrementCounter('sessionExpired.total');
  incrementCounter(`sessionExpired.byAccount.${accountId}`);
  incrementCounter(`sessionExpired.byCode.${errorCode}`);
}

function recordDatabaseError(errorCode = 'UNKNOWN') {
  incrementCounter('database.errors');
  incrementCounter(`database.errors.byCode.${errorCode}`);
}

function recordRedisError(errorCode = 'UNKNOWN') {
  incrementCounter('redis.errors');
  incrementCounter(`redis.errors.byCode.${errorCode}`);
}

function recordRateLimitBlocked(accountId, errorCode = 'RATE_LIMIT_EXCEEDED') {
  incrementCounter('rateLimit.blockedSends');
  incrementCounter(`rateLimit.blockedSends.byAccount.${accountId}`);
  incrementCounter(`rateLimit.blockedSends.byCode.${errorCode}`);
}

function recordSyncResult(accountId, ok) {
  if (ok) {
    incrementCounter('sync.success');
    incrementCounter(`sync.success.byAccount.${accountId}`);
    return;
  }

  incrementCounter('sync.failure');
  incrementCounter(`sync.failure.byAccount.${accountId}`);
}

function getMetricsSnapshot(extra = {}) {
  const queueTotals = extra?.queue?.totals || {};
  return {
    generatedAt: Date.now(),
    counters: Object.fromEntries(Array.from(counters.entries()).sort(([left], [right]) => left.localeCompare(right))),
    gauges: Object.fromEntries(Array.from(gauges.entries()).sort(([left], [right]) => left.localeCompare(right))),
    hourly: {
      messagesSent: getHourlySeries('messagesSent.hourly'),
      failedSends: getHourlySeries('messagesSent.failedHourly'),
    },
    summary: {
      messagesSentLastHour: getHourlySeries('messagesSent.hourly').slice(-1)[0]?.value || 0,
      failedSendsLastHour: getHourlySeries('messagesSent.failedHourly').slice(-1)[0]?.value || 0,
      activeBrowserContexts: getGauge('browser.activeContexts'),
      failedSendsTotal: getCounter('messagesSent.failed'),
      sessionExpiredTotal: getCounter('sessionExpired.total'),
      databaseErrorsTotal: getCounter('database.errors'),
      redisErrorsTotal: getCounter('redis.errors'),
      rateLimitBlockedSendsTotal: getCounter('rateLimit.blockedSends'),
      syncSuccessTotal: getCounter('sync.success'),
      syncFailureTotal: getCounter('sync.failure'),
      queueWaitingTotal: Number(queueTotals.waiting || 0),
      queueActiveTotal: Number(queueTotals.active || 0),
      queueDelayedTotal: Number(queueTotals.delayed || 0),
      queueFailedTotal: Number(queueTotals.failed || 0),
    },
    ...extra,
  };
}

module.exports = {
  getCounter,
  getGauge,
  getMetricsSnapshot,
  incrementCounter,
  incrementHourlyCounter,
  recordDatabaseError,
  recordMessageSent,
  recordRateLimitBlocked,
  recordRedisError,
  recordSendFailure,
  recordSessionExpired,
  recordSyncResult,
  setGauge,
};
