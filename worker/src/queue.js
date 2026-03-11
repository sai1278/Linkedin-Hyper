'use strict';

const { Queue } = require('bullmq');
const { getRedis } = require('./redisClient');

let _queue = null;

function getQueue() {
  if (_queue) return _queue;
  _queue = new Queue('linkedin-jobs', { connection: getRedis() });
  return _queue;
}

module.exports = { getQueue };
