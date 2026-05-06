'use strict';

const { getRedis } = require('../../redisClient');
const { saveCookies } = require('../../session');
const { normalizeParticipantName } = require('./common');

async function refreshSessionCookiesIfEnabled(accountId, context) {
  if (process.env.REFRESH_SESSION_COOKIES !== '1') {
    return;
  }

  await saveCookies(accountId, await context.cookies(), {
    skipIfMissingAuthCookies: true,
    source: 'sendMessageNew',
  });
}

async function recordSentMessageActivity({ accountId, participantName, profileUrl, text }) {
  const redis = getRedis();
  const entry = JSON.stringify({
    type: 'messageSent',
    accountId,
    targetName: normalizeParticipantName(participantName, profileUrl),
    targetProfileUrl: profileUrl,
    textPreview: (text || '').slice(0, 200),
    messageLength: text ? text.length : 0,
    timestamp: Date.now(),
  });

  await redis.lpush(`activity:log:${accountId}`, entry);
  await redis.ltrim(`activity:log:${accountId}`, 0, 999);
  await redis.incr(`stats:messages:${accountId}`);
}

module.exports = {
  refreshSessionCookiesIfEnabled,
  recordSentMessageActivity,
};
