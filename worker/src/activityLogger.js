import redis from './redisClient.js';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()],
});

export const logMessageSent = async (accountId, recipientProfileUrl, messagePreview, jobId) => {
    try {
        const key = `activity:${accountId}:messageSent`;
        const member = {
            profileUrl: recipientProfileUrl,
            preview: (messagePreview || '').substring(0, 80),
            jobId,
            timestamp: new Date().toISOString(),
            success: true
        };
        await redis.zadd(key, Date.now(), JSON.stringify(member));
        await redis.expire(key, 7776000);
    } catch (err) {
        logger.warn({ msg: '[activityLogger] Failed to log activity', error: err.message });
    }
};

export const logConnectionSent = async (accountId, profileUrl, notePreview, jobId) => {
    try {
        const key = `activity:${accountId}:connectionSent`;
        const member = {
            profileUrl,
            preview: (notePreview || '').substring(0, 80),
            jobId,
            timestamp: new Date().toISOString(),
            success: true
        };
        await redis.zadd(key, Date.now(), JSON.stringify(member));
        await redis.expire(key, 7776000);
    } catch (err) {
        logger.warn({ msg: '[activityLogger] Failed to log activity', error: err.message });
    }
};

export const logProfileViewed = async (accountId, profileUrl, jobId) => {
    try {
        const key = `activity:${accountId}:profileViewed`;
        const member = {
            profileUrl,
            jobId,
            timestamp: new Date().toISOString(),
            success: true
        };
        await redis.zadd(key, Date.now(), JSON.stringify(member));
        await redis.expire(key, 7776000);
    } catch (err) {
        logger.warn({ msg: '[activityLogger] Failed to log activity', error: err.message });
    }
};

export const logMessagesRead = async (accountId, count, jobId) => {
    try {
        const key = `activity:${accountId}:messagesRead`;
        const member = {
            count,
            jobId,
            timestamp: new Date().toISOString(),
            success: true
        };
        await redis.zadd(key, Date.now(), JSON.stringify(member));
        await redis.expire(key, 7776000);
    } catch (err) {
        logger.warn({ msg: '[activityLogger] Failed to log activity', error: err.message });
    }
};
