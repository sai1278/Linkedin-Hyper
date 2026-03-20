// FILE: worker/src/utils/messageFilter.js
// Time-based message filtering for 1-hour window

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Filter messages to only include those from the last N milliseconds
 * @param {Array} messages - Array of message objects
 * @param {number} windowMs - Time window in milliseconds (default: 1 hour)
 * @returns {Array} Filtered messages
 */
function filterRecentMessages(messages, windowMs = ONE_HOUR_MS) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const cutoff = Date.now() - windowMs;
  
  return messages.filter(msg => {
    const timestamp = msg.createdAt || msg.sentAt || msg.timestamp;
    if (!timestamp) return false;
    
    const time = typeof timestamp === 'string' 
      ? new Date(timestamp).getTime() 
      : timestamp;
    
    return time > cutoff;
  });
}

/**
 * Filter conversations to only include those with recent messages
 * @param {Array} conversations - Array of conversation objects
 * @param {number} windowMs - Time window in milliseconds (default: 1 hour)
 * @returns {Array} Filtered conversations
 */
function filterRecentConversations(conversations, windowMs = ONE_HOUR_MS) {
  if (!Array.isArray(conversations) || conversations.length === 0) {
    return [];
  }

  const cutoff = Date.now() - windowMs;
  
  return conversations.filter(conv => {
    // Check if last message is recent
    if (conv.lastMessage && conv.lastMessage.createdAt) {
      const time = new Date(conv.lastMessage.createdAt).getTime();
      return time > cutoff;
    }
    
    // Fallback: check conversation createdAt
    if (conv.createdAt) {
      const time = new Date(conv.createdAt).getTime();
      return time > cutoff;
    }
    
    // If no timestamp, exclude it
    return false;
  });
}

/**
 * Check if a single message is within the time window
 * @param {Object} message - Message object
 * @param {number} windowMs - Time window in milliseconds (default: 1 hour)
 * @returns {boolean} True if message is recent
 */
function isMessageRecent(message, windowMs = ONE_HOUR_MS) {
  if (!message) return false;
  
  const timestamp = message.createdAt || message.sentAt || message.timestamp;
  if (!timestamp) return false;
  
  const time = typeof timestamp === 'string' 
    ? new Date(timestamp).getTime() 
    : timestamp;
  
  return time > (Date.now() - windowMs);
}

/**
 * Get the cutoff timestamp for the time window
 * @param {number} windowMs - Time window in milliseconds (default: 1 hour)
 * @returns {number} Cutoff timestamp in milliseconds
 */
function getCutoffTime(windowMs = ONE_HOUR_MS) {
  return Date.now() - windowMs;
}

module.exports = {
  ONE_HOUR_MS,
  filterRecentMessages,
  filterRecentConversations,
  isMessageRecent,
  getCutoffTime,
};
