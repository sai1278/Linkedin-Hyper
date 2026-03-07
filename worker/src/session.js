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
};

export const loadCookies = async (accountId) => {
    const payloadStr = await redis.get('session:' + accountId);
    if (!payloadStr) return null;

    const { iv, tag, data } = JSON.parse(payloadStr);
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));

    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
};

export const deleteCookies = async (accountId) => {
    await redis.del('session:' + accountId);
};
