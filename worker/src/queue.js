'use strict';

const { Queue, QueueEvents } = require('bullmq');
const { createRedisClient }  = require('./redisClient');

let _queues            = new Map();
let _queueClients      = new Map();
let _queueEvents       = new Map();
let _queueEventsClients = new Map();

function getQueue(accountId = 'default') {
  if (_queues.has(accountId)) return _queues.get(accountId);
  // Store client alongside singleton so its connection is never orphaned.
  const client = createRedisClient();
  const q = new Queue(`linkedin-jobs:${accountId}`, { connection: client });
  _queues.set(accountId, q);
  _queueClients.set(accountId, client);
  return q;
}

function getQueueEvents(accountId = 'default') {
  if (_queueEvents.has(accountId)) return _queueEvents.get(accountId);
  const client = createRedisClient();
  const qe = new QueueEvents(`linkedin-jobs:${accountId}`, { connection: client });
  _queueEvents.set(accountId, qe);
  _queueEventsClients.set(accountId, client);
  return qe;
}

module.exports = { getQueue, getQueueEvents };
