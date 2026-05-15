'use strict';

const crypto = require('crypto');

function requireApiKey(req, res, next) {
  const secret = process.env.API_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'API_SECRET not configured' });
  }

  const provided = req.headers['x-api-key'] || '';
  if (
    provided.length !== secret.length ||
    !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

function applyRetryAfterHeader(res, err) {
  const retryAfterSec = Number.parseInt(String(err?.retryAfterSec ?? ''), 10);
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    res.set('Retry-After', String(retryAfterSec));
    return retryAfterSec;
  }
  return null;
}

function toPublicOperationError(err, fallbackMessage = 'Operation failed') {
  if (process.env.NODE_ENV !== 'production') {
    return err?.message || fallbackMessage;
  }

  const safeCodes = new Set([
    'NO_ACTIVE_SESSION',
    'NO_SESSION',
    'SESSION_EXPIRED',
    'CHECKPOINT_INCOMPLETE',
    'LOGIN_NOT_FINISHED',
    'COOKIES_MISSING',
    'AUTHENTICATED_STATE_NOT_REACHED',
    'NOT_MESSAGEABLE',
    'SEND_NOT_CONFIRMED',
    'NAVIGATION_REDIRECT_LOOP',
    'PROFILE_NAVIGATION_TIMEOUT',
    'PROFILE_NAVIGATION_FAILED',
    'RATE_LIMIT_EXCEEDED',
    'QUEUE_UNAVAILABLE',
    'READ_INBOX_TIMEOUT',
    'THREAD_NOT_REPLYABLE',
    'UNKNOWN_CHAT',
    'CHAT_ACCOUNT_MISMATCH',
  ]);

  if (err?.code && safeCodes.has(err.code) && err?.message) {
    return err.message;
  }

  return fallbackMessage;
}

module.exports = {
  requireApiKey,
  applyRetryAfterHeader,
  toPublicOperationError,
};
