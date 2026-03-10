import { Worker } from 'bullmq';
import Redis from 'ioredis';
import winston from 'winston';
import redis from './redisClient.js';
import { login } from './actions/login.js';
import { sendMessage } from './actions/sendMessage.js';
import { readMessages } from './actions/readMessages.js';
import { scrapeProfile } from './actions/scrapeProfile.js';
import { sendConnectionRequest } from './actions/connect.js';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()],
});

const worker = new Worker('linkedin-jobs', async job => {
    logger.info({ msg: `[worker] Job ${job.id} (${job.name}) started`, accountId: job.data.accountId });
    switch (job.name) {
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

const shutdown = async () => {
    await worker.close();
    process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
