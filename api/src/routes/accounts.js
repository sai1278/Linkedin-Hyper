import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { redis } from '../queue.js';
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

const router = Router();

router.post('/:accountId/session', authMiddleware, async (req, res, next) => {
    try {
        const { accountId } = req.params;
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(accountId)) {
            return res.status(400).json({ error: 'Invalid accountId format' });
        }
        const { cookies } = req.body;
        if (!Array.isArray(cookies)) {
            return res.status(400).json({ error: 'cookies must be an array' });
        }

        if (!process.env.SESSION_ENCRYPTION_KEY) {
            return res.status(500).json({ error: 'Server configuration error: SESSION_ENCRYPTION_KEY missing' });
        }
        const KEY = Buffer.from(process.env.SESSION_ENCRYPTION_KEY, 'hex');

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

        res.json({ success: true, accountId });
    } catch (err) {
        next(err);
    }
});

const LIMITS = {
    profileView: 80,
    messagesSent: 30,
    connectRequests: 20,
    searchQueries: 50,
};

router.get('/:accountId/limits', authMiddleware, async (req, res, next) => {
    try {
        const { accountId } = req.params;
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(accountId)) {
            return res.status(400).json({ error: 'Invalid accountId format' });
        }
        const limits = {};
        const actions = ['profileView', 'messagesSent', 'connectRequests', 'searchQueries'];
        const dateStr = new Date().toISOString().split('T')[0];

        for (const action of actions) {
            const key = `ratelimit:${accountId}:${action}:${dateStr}`;
            const current = parseInt(await redis.get(key) || '0', 10);
            limits[action] = {
                current,
                limit: LIMITS[action],
                remaining: Math.max(0, LIMITS[action] - current),
            };
        }
        res.json({ limits });
    } catch (err) {
        next(err);
    }
});

router.delete('/:accountId/session', authMiddleware, async (req, res, next) => {
    try {
        const { accountId } = req.params;
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(accountId)) {
            return res.status(400).json({ error: 'Invalid accountId format' });
        }
        await redis.del(`session:${accountId}`, `session:meta:${accountId}`);
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

router.get('/:accountId/session/status', authMiddleware, async (req, res, next) => {
    try {
        const { accountId } = req.params;
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(accountId)) {
            return res.status(400).json({ error: 'Invalid accountId format' });
        }
        const raw = await redis.get('session:meta:' + accountId);
        if (!raw) {
            return res.json({ exists: false });
        }
        const meta = JSON.parse(raw);
        const ageHours = (Date.now() - new Date(meta.importedAt).getTime()) / 3600000;
        res.json({
            exists: true,
            accountId: meta.accountId,
            importedAt: meta.importedAt,
            cookieCount: meta.cookieCount,
            ageHours: Math.round(ageHours * 10) / 10
        });
    } catch (err) {
        next(err);
    }
});

export default router;
