'use strict';

const { Worker } = require('bullmq');
const { createRedisClient }             = require('./redisClient');
const { getQueueName } = require('./queue');
const { logger } = require('./utils/logger');
const { runNamedJob } = require('./jobRunner');

// Concurrency 1 per account: LinkedIn triggers bans on parallel browser instances for the same IP/account.
const CONCURRENCY = 1;
const workerState = {
  startedAt: null,
  directExecution: process.env.DIRECT_EXECUTION === '1',
  queueDisabled: process.env.DISABLE_QUEUE === '1',
  schedulerEnabled: process.env.DISABLE_MESSAGE_SYNC !== '1',
  activeWorkers: 0,
  workerAccounts: [],
  lastSchedulerSetupAt: null,
  lastSchedulerError: null,
  ready: false,
};

function startWorker() {
  if (process.env.DISABLE_QUEUE === '1') {
    workerState.startedAt = Date.now();
    workerState.ready = true;
    logger.warn('worker.queue_disabled', { mode: 'direct-execution' });
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
        logger.info('worker.job_processing', {
          accountId,
          jobId: job.id,
          jobName: name,
        });
        return runNamedJob(name, data);
      },
      {
        connection:    createRedisClient(), // dedicated connection for BullMQ worker
        concurrency:   CONCURRENCY,
        lockDuration:  120_000, // auto-release lock after 2 min if no heartbeat (crash recovery)
        lockRenewTime:  60_000, // renew every 60 s for long-running jobs
      }
    );

    worker.on('completed', (job) => {
      logger.info('worker.job_completed', {
        accountId,
        jobId: job.id,
        jobName: job.name,
      });
    });

    worker.on('failed', (job, err) => {
      logger.error('worker.job_failed', {
        accountId,
        jobId: job?.id,
        jobName: job?.name,
        errorCode: err?.code || 'WORKER_JOB_FAILED',
        error: err,
      });
    });

    worker.on('error', (err) => {
      logger.error('worker.runtime_error', {
        accountId,
        errorCode: err?.code || 'WORKER_RUNTIME_ERROR',
        error: err,
      });
    });
    
    workers.push(worker);
  }

  workerState.startedAt = Date.now();
  workerState.activeWorkers = workers.length;
  workerState.workerAccounts = ids;
  workerState.ready = workers.length > 0;
  logger.info('worker.started', {
    activeWorkers: workers.length,
    concurrency: CONCURRENCY,
  });
  
  if (process.env.DISABLE_MESSAGE_SYNC === '1') {
    workerState.schedulerEnabled = false;
    logger.warn('worker.scheduler_disabled', { reason: 'DISABLE_MESSAGE_SYNC=1' });
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
        logger.info('worker.scheduler_removed_existing', { jobName: 'messageSync' });
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

    workerState.lastSchedulerSetupAt = Date.now();
    workerState.lastSchedulerError = null;
    logger.info('worker.scheduler_configured', {
      syncIntervalMinutes,
    });

    // Trigger initial sync after 30 seconds (give system time to start)
    setTimeout(async () => {
      try {
        await queue.add('messageSync', { proxyUrl, source: 'scheduler' }, { jobId: 'messageSync-initial' });
        logger.info('worker.scheduler_initial_sync_triggered');
      } catch (error) {
        logger.warn('worker.scheduler_initial_sync_skipped', {
          errorCode: error?.code || 'INITIAL_SYNC_SKIPPED',
          error: error,
        });
      }
    }, 30000);

  } catch (error) {
    workerState.lastSchedulerError = error?.message || String(error);
    logger.error('worker.scheduler_failed', {
      errorCode: error?.code || 'SCHEDULER_FAILED',
      error,
    });
  }
}

function getWorkerStatus() {
  return {
    ...workerState,
  };
}

module.exports = { startWorker, getWorkerStatus };
