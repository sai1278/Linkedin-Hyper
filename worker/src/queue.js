'use strict';

const { Queue, QueueEvents } = require('bullmq');
const { createRedisClient }  = require('./redisClient');
const { logger } = require('./utils/logger');

let _queues            = new Map();
let _queueClients      = new Map();
let _queueEvents       = new Map();
let _queueEventsClients = new Map();

function getQueueName(accountId = 'default') {
  const normalized = String(accountId).trim() || 'default';
  // BullMQ disallows ":" in queue names.
  const safeAccountId = normalized.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `linkedin-jobs-${safeAccountId}`;
}

function getQueue(accountId = 'default') {
  if (_queues.has(accountId)) return _queues.get(accountId);
  // Store client alongside singleton so its connection is never orphaned.
  const client = createRedisClient();
  const q = new Queue(getQueueName(accountId), { connection: client });
  q.on('error', (err) => {
    logger.error('queue.error', {
      accountId,
      errorCode: err?.code || 'QUEUE_ERROR',
      error: err,
    });
  });
  _queues.set(accountId, q);
  _queueClients.set(accountId, client);
  return q;
}

function getQueueEvents(accountId = 'default') {
  if (_queueEvents.has(accountId)) return _queueEvents.get(accountId);
  const client = createRedisClient();
  const qe = new QueueEvents(getQueueName(accountId), { connection: client });
  qe.on('error', (err) => {
    logger.error('queue_events.error', {
      accountId,
      errorCode: err?.code || 'QUEUE_EVENTS_ERROR',
      error: err,
    });
  });
  _queueEvents.set(accountId, qe);
  _queueEventsClients.set(accountId, client);
  return qe;
}

module.exports = { getQueue, getQueueEvents, getQueueName };
