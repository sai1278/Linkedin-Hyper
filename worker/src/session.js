'use strict';

const crypto = require('crypto');
const { getRedis } = require('./redisClient');

const ALGORITHM   = 'aes-256-gcm';
const SESSION_TTL = 86400 * 30; // 30 days
const META_TTL    = 86400 * 30;

function getKey() {
  const hex = process.env.SESSION_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'SESSION_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). ' +
      'Generate with: openssl rand -hex 32'
    );
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plaintext) {
  const iv     = crypto.randomBytes(16);
  const key    = getKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return JSON.stringify({
    iv:   iv.toString('hex'),
    tag:  tag.toString('hex'),
    data: enc.toString('hex'),
  });
}

function decrypt(payload) {
  const { iv, tag, data } = JSON.parse(payload);
  const key      = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

/** Normalise sameSite values to what Playwright accepts */
function normaliseCookies(cookies) {
  return cookies.map((c) => ({
    ...c,
    sameSite: (() => {
      const v = (c.sameSite || '').toLowerCase();
      if (v === 'strict') return 'Strict';
      if (v === 'lax')    return 'Lax';
      return 'None';  // default fallback — NOT 'Lax'
    })(),
  }));
}

async function saveCookies(accountId, cookies) {
  const redis     = getRedis();
  const normalised = normaliseCookies(cookies);
  const encrypted  = encrypt(JSON.stringify(normalised));
  const now        = Date.now();

  // Pipeline both writes into a single round-trip
  const pipeline = redis.pipeline();
  pipeline.set(`session:${accountId}`,      encrypted,                         'EX', SESSION_TTL);
  pipeline.set(`session:meta:${accountId}`, JSON.stringify({ savedAt: now }), 'EX', META_TTL);
  await pipeline.exec();
}

async function loadCookies(accountId) {
  const redis = getRedis();
  const raw   = await redis.get(`session:${accountId}`);
  if (!raw) return null;
  return JSON.parse(decrypt(raw));
}

async function sessionMeta(accountId) {
  const redis = getRedis();
  const raw   = await redis.get(`session:meta:${accountId}`);
  if (!raw) return null;
  const meta  = JSON.parse(raw);
  const ageMs = Date.now() - meta.savedAt;
  return { savedAt: meta.savedAt, ageSeconds: Math.floor(ageMs / 1000) };
}

async function deleteSession(accountId) {
  const redis = getRedis();
  await redis.del(`session:${accountId}`, `session:meta:${accountId}`);
}

module.exports = { saveCookies, loadCookies, sessionMeta, deleteSession };
