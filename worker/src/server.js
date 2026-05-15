'use strict';

const http = require('http');
const { createApp } = require('./app');
const { logger } = require('./utils/logger');
const { initializeWebSocket } = require('./utils/websocket');
const { startWorker } = require('./worker');

function startServer() {
  const app = createApp();
  const port = process.env.PORT || 3001;

  startWorker();

  const server = http.createServer(app);
  initializeWebSocket(server);

  server.listen(port, '0.0.0.0', () => {
    logger.info('worker.api_listening', { port });
    logger.info('worker.websocket_ready', { port });
  });

  return { app, server };
}

module.exports = {
  startServer,
};
