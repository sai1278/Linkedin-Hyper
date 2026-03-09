import { Worker } from 'bullmq';
import Redis from 'ioredis';
import winston from 'winston';
import redis from './redisClient.js';
import { login } from './actions/login.js';
import { sendMessage } from './actions/sendMessage.js';
import { readMessages } from './actions/readMessages.js';
import { scrapeProfile } from './actions/scrapeProfile.js';
import { sendConnectionRequest } from './actions/connect.js';
import { saveCookies } from './session.js';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()],
});

const worker = new Worker('linkedin-jobs', async job => {
    logger.info({ msg: `[worker] Job ${job.id} (${job.name}) started`, accountId: job.data.accountId });
    switch (job.name) {
        case 'login':
            return await login(job.data);
        case 'sendMessage':
            return await sendMessage({ ...job.data, _jobId: job.id });
        case 'readMessages':
            return await readMessages(job.data);
        case 'scrapeProfile':
            return await scrapeProfile({ ...job.data, _jobId: job.id });
        case 'connect':
            return await sendConnectionRequest({ ...job.data, _jobId: job.id });
        default:
            throw new Error('Unknown job: ' + job.name);
    }
}, {
    connection: redis,
    concurrency: 1
});

worker.on('completed', job => {
    logger.info({ msg: `[worker] Job ${job.id} (${job.name}) completed`, accountId: job.data.accountId });
});

worker.on('failed', (job, err) => {
    logger.error({ msg: `[worker] Job ${job?.id} failed: ${err.message}` });
});

const subscriber = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

subscriber.on('error', (err) => {
    logger.error({ msg: '[subscriber] Redis error', error: err.message });
});

subscriber.subscribe('session:import', (err) => {
    if (err) logger.error({ msg: '[subscriber] Subscribe failed', error: err.message });
    else logger.info({ msg: '[subscriber] Listening on session:import channel' });
});

subscriber.on('message', async (channel, message) => {
    if (channel !== 'session:import') return;
    try {
        const { accountId, cookies } = JSON.parse(message);
        await saveCookies(accountId, cookies);
        logger.info({ msg: '[subscriber] Session imported successfully', accountId });
    } catch (err) {
        logger.error({ msg: '[subscriber] Failed to import session', error: err.message });
    }
});

const shutdown = async () => {
    await worker.close();
    await subscriber.quit();
    process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
