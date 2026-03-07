import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { redis } from '../queue.js';

const router = Router();

router.post('/:accountId/session', authMiddleware, async (req, res, next) => {
    try {
        const { accountId } = req.params;
        const { cookies } = req.body;
        if (!Array.isArray(cookies)) {
            return res.status(400).json({ error: 'cookies must be an array' });
        }
        await redis.publish('session:import', JSON.stringify({ accountId, cookies }));
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
        await redis.del(`session:${accountId}`);
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

export default router;
