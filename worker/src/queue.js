'use strict';

const { Queue, QueueEvents } = require('bullmq');
const { createRedisClient }  = require('./redisClient');

let _queue            = null;
let _queueClient      = null;
let _queueEvents      = null;
let _queueEventsClient = null;

function getQueue() {
  if (_queue) return _queue;
  // Store client alongside singleton so its connection is never orphaned.
  _queueClient = createRedisClient();
  _queue = new Queue('linkedin-jobs', { connection: _queueClient });
  return _queue;
}

function getQueueEvents() {
  if (_queueEvents) return _queueEvents;
  _queueEventsClient = createRedisClient();
  _queueEvents = new QueueEvents('linkedin-jobs', { connection: _queueEventsClient });
  return _queueEvents;
}

module.exports = { getQueue, getQueueEvents };
