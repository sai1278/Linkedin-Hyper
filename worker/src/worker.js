'use strict';

const { Worker } = require('bullmq');
const { getRedis, createRedisClient }  = require('./redisClient');

const { verifySession }         = require('./actions/login');
const { readMessages }          = require('./actions/readMessages');
const { readThread }            = require('./actions/readThread');
const { sendMessage }           = require('./actions/sendMessage');
const { sendMessageNew }        = require('./actions/sendMessageNew');
const { sendConnectionRequest } = require('./actions/connect');
const { searchPeople }          = require('./actions/searchPeople');

// Hard-clamped to 1: LinkedIn will flag parallel browser sessions from the same IP/account.
const CONCURRENCY = 1;

function startWorker() {
  const worker = new Worker(
    'linkedin-jobs',
    async (job) => {
      const { name, data } = job;
      console.log(`[Worker] Processing job ${job.id}: ${name}`);

      switch (name) {
        case 'verifySession':         return verifySession(data);
        case 'readMessages':          return readMessages(data);
        case 'readThread':            return readThread(data);
        case 'sendMessage':           return sendMessage(data);
        case 'sendMessageNew':        return sendMessageNew(data);
        case 'sendConnectionRequest': return sendConnectionRequest(data);
        case 'searchPeople':          return searchPeople(data);
        default:
          throw new Error(`Unknown job type: ${name}`);
      }
    },
    {
      connection:  createRedisClient(),
      concurrency: CONCURRENCY,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} (${job.name}) completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job.id} (${job?.name}) failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[Worker] Worker error:', err);
  });

  console.log(`[Worker] Started with concurrency ${CONCURRENCY}`);
  return worker;
}

module.exports = { startWorker };
