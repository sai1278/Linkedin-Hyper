'use strict';

async function sendMessage() {
  const err = new Error('The legacy sendMessage action is deprecated. Use sendMessageNew with profileUrl or chatId.');
  err.code = 'SEND_ROUTE_DEPRECATED';
  err.status = 410;
  throw err;
}

module.exports = { sendMessage };
