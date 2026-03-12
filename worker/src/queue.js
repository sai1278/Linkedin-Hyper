'use strict';

const { Queue, QueueEvents } = require('bullmq');
const { getRedis, createRedisClient } = require('./redisClient');

let _queue = null;
let _queueEvents = null;

function getQueue() {
  if (_queue) return _queue;
  _queue = new Queue('linkedin-jobs', { connection: createRedisClient() });
  return _queue;
}

function getQueueEvents() {
  if (_queueEvents) return _queueEvents;
  _queueEvents = new QueueEvents('linkedin-jobs', { connection: createRedisClient() });
  return _queueEvents;
}

module.exports = { getQueue, getQueueEvents };
