'use strict';

const { verifySession } = require('./actions/login');
const { readMessages } = require('./actions/readMessages');
const { readConnections } = require('./actions/readConnections');
const { readThread } = require('./actions/readThread');
const { sendMessageNew } = require('./actions/sendMessageNew');
const { sendConnectionRequest } = require('./actions/connect');
const { searchPeople } = require('./actions/searchPeople');
const { syncAllAccounts } = require('./services/messageSyncService');

function createDeprecatedSendError() {
  const err = new Error('The legacy sendMessage job is deprecated. Use sendMessageNew with profileUrl or chatId.');
  err.code = 'SEND_ROUTE_DEPRECATED';
  err.status = 410;
  return err;
}

async function runNamedJob(name, data) {
  switch (name) {
    case 'verifySession':
      return verifySession(data);
    case 'readMessages':
      return readMessages(data);
    case 'readConnections':
      return readConnections(data);
    case 'readThread':
      return readThread(data);
    case 'sendMessage':
      throw createDeprecatedSendError();
    case 'sendMessageNew':
      return sendMessageNew(data);
    case 'sendConnectionRequest':
      return sendConnectionRequest(data);
    case 'searchPeople':
      return searchPeople(data);
    case 'messageSync':
      return syncAllAccounts(data.proxyUrl, { source: data.source });
    default:
      throw new Error(`Unknown job type: ${name}`);
  }
}

module.exports = {
  runNamedJob,
  createDeprecatedSendError,
};
