import crypto from 'crypto';
import redis from './redisClient.js';

const ALGORITHM = 'aes-256-gcm';
if (!process.env.SESSION_ENCRYPTION_KEY) {
    throw new Error('FATAL: SESSION_ENCRYPTION_KEY environment variable is not set');
}
const KEY = Buffer.from(process.env.SESSION_ENCRYPTION_KEY, 'hex');
if (KEY.length !== 32) {
    throw new Error('FATAL: SESSION_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
}

const SAMESITE_MAP = {
    'no_restriction': 'None',
    'unspecified': 'None',
    'lax': 'Lax',
    'strict': 'Strict',
    'none': 'None',
};

const normaliseCookies = (cookies) => cookies.map(cookie => {
    const raw = (cookie.sameSite || 'None').toLowerCase().replace(/-/g, '_');
    return { ...cookie, sameSite: SAMESITE_MAP[raw] ?? 'None' };
});

export const saveCookies = async (accountId, cookies) => {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    const jsonStr = JSON.stringify(cookies);
    let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');

    const payload = JSON.stringify({
        iv: iv.toString('hex'),
        tag,
        data: encrypted
    });

    await redis.set('session:' + accountId, payload, 'EX', 86400 * 30);
    await redis.set('session:meta:' + accountId, JSON.stringify({ accountId, importedAt: new Date().toISOString(), cookieCount: cookies.length }), 'EX', 86400 * 30);
};

export const loadCookies = async (accountId) => {
    const payloadStr = await redis.get('session:' + accountId);
    if (!payloadStr) return null;

    const { iv, tag, data } = JSON.parse(payloadStr);
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));

    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    const parsedCookies = JSON.parse(decrypted);

    const metaRaw = await redis.get('session:meta:' + accountId);
    if (metaRaw) {
        const meta = JSON.parse(metaRaw);
        const ageHours = (Date.now() - new Date(meta.importedAt).getTime()) / 3600000;
        if (ageHours > parseInt(process.env.SESSION_MAX_AGE_HOURS || '12', 10)) {
            console.warn('[session] WARNING: session for ' + accountId + ' is ' + Math.floor(ageHours) + ' hours old — consider re-importing cookies');
        }
    }

    return normaliseCookies(parsedCookies);
};

export const deleteCookies = async (accountId) => {
    await redis.del('session:' + accountId, 'session:meta:' + accountId);
};

export const getSessionMeta = async (accountId) => {
    const raw = await redis.get('session:meta:' + accountId);
    if (!raw) return null;
    return JSON.parse(raw);
};
