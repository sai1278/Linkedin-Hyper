import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { redis } from '../queue.js';

const router = Router();

const startOfTodayMs = () => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
};
const msAgo = (days) => Date.now() - days * 86400 * 1000;

const queryCounts = async (key) => {
    const [allTime, today, yesterday, last7days, last30days] = await Promise.all([
        redis.zcard(key),
        redis.zcount(key, startOfTodayMs(), '+inf'),
        redis.zcount(key, startOfTodayMs() - 86400000, startOfTodayMs() - 1),
        redis.zcount(key, msAgo(7), '+inf'),
        redis.zcount(key, msAgo(30), '+inf'),
    ]);
    return { allTime, today, yesterday, last7days, last30days };
};

const buildSummary = async (accountId) => {
    const [messagesSent, connectionsSent, profilesViewed] = await Promise.all([
        queryCounts(`activity:${accountId}:messageSent`),
        queryCounts(`activity:${accountId}:connectionSent`),
        queryCounts(`activity:${accountId}:profileViewed`),
    ]);
    return { accountId, generatedAt: new Date().toISOString(), messagesSent, connectionsSent, profilesViewed };
};

router.get('/all/summary', authMiddleware, async (req, res, next) => {
    try {
        const keys = [];
        let cursor = '0';
        do {
            const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', 'session:meta:*', 'COUNT', 100);
            cursor = nextCursor;
            keys.push(...batch);
        } while (cursor !== '0');
        const accountIds = new Set();
        for (const key of keys) {
            const parts = key.split(':');
            if (parts.length >= 3) {
                accountIds.add(parts[2]);
            }
        }

        if (accountIds.size === 0) {
            return res.json({
                accountId: 'all',
                generatedAt: new Date().toISOString(),
                accountsTracked: 0,
                messagesSent: { allTime: 0, today: 0, yesterday: 0, last7days: 0, last30days: 0 },
                connectionsSent: { allTime: 0, today: 0, yesterday: 0, last7days: 0, last30days: 0 },
                profilesViewed: { allTime: 0, today: 0, yesterday: 0, last7days: 0, last30days: 0 }
            });
        }

        let totalMessagesSent = { allTime: 0, today: 0, yesterday: 0, last7days: 0, last30days: 0 };
        let totalConnectionsSent = { allTime: 0, today: 0, yesterday: 0, last7days: 0, last30days: 0 };
        let totalProfilesViewed = { allTime: 0, today: 0, yesterday: 0, last7days: 0, last30days: 0 };

        for (const accountId of accountIds) {
            const summary = await buildSummary(accountId);
            for (const key of Object.keys(totalMessagesSent)) {
                totalMessagesSent[key] += summary.messagesSent[key] || 0;
            }
            for (const key of Object.keys(totalConnectionsSent)) {
                totalConnectionsSent[key] += summary.connectionsSent[key] || 0;
            }
            for (const key of Object.keys(totalProfilesViewed)) {
                totalProfilesViewed[key] += summary.profilesViewed[key] || 0;
            }
        }

        res.json({
            accountId: 'all',
            generatedAt: new Date().toISOString(),
            accountsTracked: accountIds.size,
            messagesSent: totalMessagesSent,
            connectionsSent: totalConnectionsSent,
            profilesViewed: totalProfilesViewed
        });
    } catch (err) {
        next(err);
    }
});

router.get('/:accountId/summary', authMiddleware, async (req, res, next) => {
    try {
        const { accountId } = req.params;
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(accountId)) {
            return res.status(400).json({ error: 'Invalid accountId format' });
        }
        const summary = await buildSummary(accountId);
        res.json(summary);
    } catch (err) {
        next(err);
    }
});

router.get('/:accountId/activity', authMiddleware, async (req, res, next) => {
    try {
        const { accountId } = req.params;
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(accountId)) {
            return res.status(400).json({ error: 'Invalid accountId format' });
        }
        const { action, from, to } = req.query;

        if (!action || !['messageSent', 'connectionSent', 'profileViewed'].includes(action)) {
            return res.status(400).json({ error: 'action must be one of: messageSent, connectionSent, profileViewed' });
        }

        let fromMs = from ? new Date(from).getTime() : msAgo(30);
        if (isNaN(fromMs)) {
            fromMs = msAgo(30);
        }

        let toMs = Date.now();
        if (to) {
            const parsedTo = new Date(to).getTime();
            if (!isNaN(parsedTo)) {
                toMs = parsedTo + 86400000 - 1;
            }
        }

        const key = `activity:${accountId}:${action}`;
        const dataStr = await redis.zrangebyscore(key, fromMs, toMs);

        const entries = [];
        for (const item of dataStr) {
            try {
                entries.push(JSON.parse(item));
            } catch (e) {
                // skip invalid json
            }
        }

        const limitedEntries = entries.slice(0, 500);

        res.json({
            accountId,
            action,
            from: new Date(fromMs).toISOString(),
            to: new Date(toMs).toISOString(),
            count: limitedEntries.length,
            entries: limitedEntries
        });
    } catch (err) {
        next(err);
    }
});

export default router;
