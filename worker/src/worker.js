'use strict';

const { Worker } = require('bullmq');
const { createRedisClient }             = require('./redisClient');
const { getQueueName } = require('./queue');

const { verifySession }         = require('./actions/login');
const { readMessages }          = require('./actions/readMessages');
const { readConnections }       = require('./actions/readConnections');
const { readThread }            = require('./actions/readThread');
const { sendMessage }           = require('./actions/sendMessage');
const { sendMessageNew }        = require('./actions/sendMessageNew');
const { sendConnectionRequest } = require('./actions/connect');
const { searchPeople }          = require('./actions/searchPeople');
const { syncAllAccounts }       = require('./services/messageSyncService');

// Concurrency 1 per account: LinkedIn triggers bans on parallel browser instances for the same IP/account.
const CONCURRENCY = 1;

function startWorker() {
  if (process.env.DISABLE_QUEUE === '1') {
    console.log('[Worker] Queue workers disabled by DISABLE_QUEUE=1');
    return [];
  }

  const ids = (process.env.ACCOUNT_IDS || 'default').split(',').map(s => s.trim()).filter(Boolean);
  if (ids.length === 0) ids.push('default');
  
  const workers = [];

  for (const accountId of ids) {
    const worker = new Worker(
      getQueueName(accountId),
      async (job) => {
        const { name, data } = job;
        console.log(`[Worker:${accountId}] Processing job ${job.id}: ${name}`);

        switch (name) {
          case 'verifySession':         return verifySession(data);
          case 'readMessages':          return readMessages(data);
          case 'readConnections':       return readConnections(data);
          case 'readThread':            return readThread(data);
          case 'sendMessage':           return sendMessage(data);
          case 'sendMessageNew':        return sendMessageNew(data);
          case 'sendConnectionRequest': return sendConnectionRequest(data);
          case 'searchPeople':          return searchPeople(data);
          case 'messageSync':           return syncAllAccounts(data.proxyUrl, { source: data.source });
          default:
            throw new Error(`Unknown job type: ${name}`);
        }
      },
      {
        connection:    createRedisClient(), // dedicated connection for BullMQ worker
        concurrency:   CONCURRENCY,
        lockDuration:  120_000, // auto-release lock after 2 min if no heartbeat (crash recovery)
        lockRenewTime:  60_000, // renew every 60 s for long-running jobs
      }
    );

    worker.on('completed', (job) => {
      console.log(`[Worker:${accountId}] Job ${job.id} (${job.name}) completed`);
    });

    worker.on('failed', (job, err) => {
      console.error(
        `[Worker:${accountId}] Job ${job.id} (${job?.name}) failed:`,
        err?.message || String(err)
      );
      if (err?.stack) {
        console.error(`[Worker:${accountId}] Failure stack:\n${err.stack}`);
      }
    });

    worker.on('error', (err) => {
      console.error(`[Worker:${accountId}] Worker error:`, err);
    });
    
    workers.push(worker);
  }

  console.log(`[Worker] Started ${workers.length} worker threads with concurrency ${CONCURRENCY} per worker.`);
  
  if (process.env.DISABLE_MESSAGE_SYNC === '1') {
    console.log('[Worker] Message sync scheduler disabled by DISABLE_MESSAGE_SYNC=1');
    return workers;
  }

  // Schedule background message sync (every 10 minutes, staggered between accounts)
  scheduleMessageSync();
  
  return workers;
}

/**
 * Schedule recurring message sync job
 * Syncs every 10 minutes to respect rate limits (6 syncs/hour < 30 reads/hour)
 */
async function scheduleMessageSync() {
  const { getQueue } = require('./queue');
  const queue = getQueue();
  
  const syncIntervalMinutes = parseInt(process.env.SYNC_INTERVAL_MINUTES || '10', 10);
  const proxyUrl = process.env.PROXY_URL || null;

  try {
    // Remove any existing message sync jobs
    const existingJobs = await queue.getRepeatableJobs();
    for (const job of existingJobs) {
      if (job.name === 'messageSync') {
        await queue.removeRepeatableByKey(job.key);
        console.log('[Worker] Removed existing messageSync job');
      }
    }

    // Add recurring message sync job
    await queue.add(
      'messageSync',
      { proxyUrl, source: 'scheduler' },
      {
        repeat: {
          pattern: `*/${syncIntervalMinutes} * * * *`, // Every N minutes
        },
        jobId: 'messageSync-recurring',
      }
    );

    console.log(`[Worker] Scheduled message sync every ${syncIntervalMinutes} minutes`);

    // Trigger initial sync after 30 seconds (give system time to start)
    setTimeout(async () => {
      try {
        await queue.add('messageSync', { proxyUrl, source: 'scheduler' }, { jobId: 'messageSync-initial' });
        console.log('[Worker] Triggered initial message sync');
      } catch (error) {
        console.error('[Worker] Initial message sync skipped:', error.message);
      }
    }, 30000);

  } catch (error) {
    console.error('[Worker] Failed to schedule message sync:', error);
  }
}

module.exports = { startWorker };
