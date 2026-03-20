// FILE: worker/src/utils/websocket.js
// WebSocket server management using Socket.IO

const { Server } = require('socket.io');

let io = null;

/**
 * Initialize WebSocket server
 * @param {Object} httpServer - HTTP server instance
 * @returns {Object} Socket.IO instance
 */
function initializeWebSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    console.log('[WebSocket] Client connected:', socket.id);

    // Handle client joining account-specific rooms
    socket.on('join:account', (accountId) => {
      if (accountId) {
        socket.join(`account:${accountId}`);
        console.log(`[WebSocket] Client ${socket.id} joined room: account:${accountId}`);
      }
    });

    // Handle client leaving account rooms
    socket.on('leave:account', (accountId) => {
      if (accountId) {
        socket.leave(`account:${accountId}`);
        console.log(`[WebSocket] Client ${socket.id} left room: account:${accountId}`);
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('[WebSocket] Client disconnected:', socket.id);
    });

    // Send welcome message
    socket.emit('connected', {
      message: 'Connected to LinkedIn Automation WebSocket',
      timestamp: new Date().toISOString(),
    });
  });

  console.log('[WebSocket] Server initialized');
  return io;
}

/**
 * Get the Socket.IO instance
 * @returns {Object|null} Socket.IO instance
 */
function getIO() {
  if (!io) {
    console.warn('[WebSocket] Socket.IO not initialized');
  }
  return io;
}

/**
 * Emit event to all connected clients
 * @param {string} event - Event name
 * @param {Object} data - Event data
 */
function broadcastEvent(event, data) {
  const socketIO = getIO();
  if (socketIO) {
    socketIO.emit(event, {
      ...data,
      timestamp: new Date().toISOString(),
    });
    console.log(`[WebSocket] Broadcast event: ${event}`);
  }
}

/**
 * Emit event to specific account room
 * @param {string} accountId - Account ID
 * @param {string} event - Event name
 * @param {Object} data - Event data
 */
function emitToAccount(accountId, event, data) {
  const socketIO = getIO();
  if (socketIO && accountId) {
    socketIO.to(`account:${accountId}`).emit(event, {
      ...data,
      accountId,
      timestamp: new Date().toISOString(),
    });
    console.log(`[WebSocket] Emit to account:${accountId} - ${event}`);
  }
}

/**
 * Emit inbox update event
 * @param {string} accountId - Account ID
 * @param {Object} inboxData - Inbox data
 */
function emitInboxUpdate(accountId, inboxData) {
  emitToAccount(accountId, 'inbox:updated', inboxData);
  broadcastEvent('inbox:updated', { accountId, ...inboxData });
}

/**
 * Emit new message event
 * @param {string} accountId - Account ID
 * @param {Object} message - Message data
 */
function emitNewMessage(accountId, message) {
  emitToAccount(accountId, 'inbox:new_message', message);
  broadcastEvent('inbox:new_message', { accountId, ...message });
}

/**
 * Emit account status change event
 * @param {string} accountId - Account ID
 * @param {Object} status - Status data
 */
function emitAccountStatus(accountId, status) {
  emitToAccount(accountId, 'account:status', status);
  broadcastEvent('account:status', { accountId, ...status });
}

/**
 * Emit rate limit update event
 * @param {string} accountId - Account ID
 * @param {Object} rateLimit - Rate limit data
 */
function emitRateLimitUpdate(accountId, rateLimit) {
  emitToAccount(accountId, 'rate_limit:updated', rateLimit);
}

module.exports = {
  initializeWebSocket,
  getIO,
  broadcastEvent,
  emitToAccount,
  emitInboxUpdate,
  emitNewMessage,
  emitAccountStatus,
  emitRateLimitUpdate,
};
