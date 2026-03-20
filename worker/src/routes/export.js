// FILE: worker/src/routes/export.js
// Export API endpoints for messages and activity logs

'use strict';

const express = require('express');
const { getRedis } = require('../redisClient');
const { readMessages } = require('../actions/readMessages');
const { readThread } = require('../actions/readThread');

const router = express.Router();

/**
 * Convert data to CSV format
 */
function toCSV(headers, rows) {
  const escape = (val) => {
    if (val == null) return '';
    const str = String(val);
    // Escape quotes and wrap in quotes if contains comma, quote, or newline
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvHeaders = headers.join(',');
  const csvRows = rows.map(row => row.map(escape).join(',')).join('\n');
  
  return `${csvHeaders}\n${csvRows}`;
}

/**
 * POST /export/messages
 * Export messages as CSV or JSON
 * Body: { accountId?, format: 'csv'|'json', chatId? }
 */
router.post('/messages', async (req, res) => {
  try {
    const { accountId, format = 'csv', chatId } = req.body;
    
    if (!format || !['csv', 'json'].includes(format)) {
      return res.status(400).json({ error: 'format must be "csv" or "json"' });
    }

    const proxyUrl = process.env.PROXY_URL || null;
    let allMessages = [];
    let accountIds = [];

    // Determine which accounts to export
    if (accountId) {
      accountIds = [accountId];
    } else {
      // Export all accounts
      accountIds = (process.env.ACCOUNT_IDS ?? '').split(',').filter(Boolean);
    }

    // If specific chatId provided, export only that thread
    if (chatId && accountId) {
      const threadData = await readThread({ accountId, chatId, proxyUrl });
      allMessages = threadData.items.map(msg => ({
        timestamp: new Date(msg.createdAt).getTime(),
        date: new Date(msg.createdAt).toLocaleDateString(),
        time: new Date(msg.createdAt).toLocaleTimeString(),
        accountId,
        conversationId: chatId,
        sender: msg.senderName,
        message: msg.text,
        isSentByMe: msg.senderId === '__self__',
      }));
    } else {
      // Export all conversations for account(s)
      for (const accId of accountIds) {
        try {
          // Get conversations
          const inboxData = await readMessages({ accountId: accId, proxyUrl });
          
          // For each conversation, get full thread
          for (const conv of inboxData.items) {
            try {
              const threadData = await readThread({ 
                accountId: accId, 
                chatId: conv.id, 
                proxyUrl 
              });
              
              const messages = threadData.items.map(msg => ({
                timestamp: new Date(msg.createdAt).getTime(),
                date: new Date(msg.createdAt).toLocaleDateString(),
                time: new Date(msg.createdAt).toLocaleTimeString(),
                accountId: accId,
                conversationId: conv.id,
                participantName: conv.participants[0]?.name || 'Unknown',
                sender: msg.senderName,
                message: msg.text,
                isSentByMe: msg.senderId === '__self__',
              }));
              
              allMessages.push(...messages);
            } catch (err) {
              console.error(`[Export] Failed to fetch thread ${conv.id}:`, err.message);
            }
          }
        } catch (err) {
          console.error(`[Export] Failed to fetch messages for ${accId}:`, err.message);
        }
      }
    }

    // Sort by timestamp
    allMessages.sort((a, b) => a.timestamp - b.timestamp);

    if (format === 'csv') {
      const headers = ['Timestamp', 'Date', 'Time', 'Account', 'Conversation ID', 'Participant', 'Sender', 'Message', 'Sent By Me'];
      const rows = allMessages.map(msg => [
        msg.timestamp,
        msg.date,
        msg.time,
        msg.accountId,
        msg.conversationId,
        msg.participantName || '',
        msg.sender,
        msg.message,
        msg.isSentByMe ? 'Yes' : 'No',
      ]);

      const csv = toCSV(headers, rows);
      const filename = `linkedin-messages-${new Date().toISOString().split('T')[0]}.csv`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } else {
      // JSON format
      const filename = `linkedin-messages-${new Date().toISOString().split('T')[0]}.json`;
      const jsonData = {
        exportedAt: new Date().toISOString(),
        totalMessages: allMessages.length,
        accounts: accountIds,
        messages: allMessages,
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json(jsonData);
    }
  } catch (err) {
    console.error('[Export] Error:', err);
    res.status(500).json({ 
      error: process.env.NODE_ENV === 'production' ? 'Export failed' : err.message 
    });
  }
});

/**
 * POST /export/activity
 * Export activity logs as CSV or JSON
 * Body: { accountId?, format: 'csv'|'json', limit? }
 */
router.post('/activity', async (req, res) => {
  try {
    const { accountId, format = 'csv', limit = 1000 } = req.body;
    
    if (!format || !['csv', 'json'].includes(format)) {
      return res.status(400).json({ error: 'format must be "csv" or "json"' });
    }

    const redis = getRedis();
    let allActivity = [];
    let accountIds = [];

    // Determine which accounts to export
    if (accountId) {
      accountIds = [accountId];
    } else {
      accountIds = (process.env.ACCOUNT_IDS ?? '').split(',').filter(Boolean);
    }

    // Fetch activity logs from Redis
    for (const accId of accountIds) {
      try {
        const key = `activity:log:${accId}`;
        const logs = await redis.lrange(key, 0, limit - 1);
        
        const parsed = logs.map(log => {
          try {
            const entry = JSON.parse(log);
            return {
              ...entry,
              accountId: accId,
            };
          } catch {
            return null;
          }
        }).filter(Boolean);
        
        allActivity.push(...parsed);
      } catch (err) {
        console.error(`[Export] Failed to fetch activity for ${accId}:`, err.message);
      }
    }

    // Sort by timestamp (most recent first)
    allActivity.sort((a, b) => b.timestamp - a.timestamp);

    if (format === 'csv') {
      const headers = ['Timestamp', 'Date', 'Time', 'Account', 'Type', 'Target Name', 'Target Profile URL', 'Message'];
      const rows = allActivity.map(activity => [
        activity.timestamp,
        new Date(activity.timestamp).toLocaleDateString(),
        new Date(activity.timestamp).toLocaleTimeString(),
        activity.accountId,
        activity.type,
        activity.targetName || '',
        activity.targetProfileUrl || '',
        activity.message || '',
      ]);

      const csv = toCSV(headers, rows);
      const filename = `linkedin-activity-${new Date().toISOString().split('T')[0]}.csv`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } else {
      // JSON format
      const filename = `linkedin-activity-${new Date().toISOString().split('T')[0]}.json`;
      const jsonData = {
        exportedAt: new Date().toISOString(),
        totalEntries: allActivity.length,
        accounts: accountIds,
        activity: allActivity,
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json(jsonData);
    }
  } catch (err) {
    console.error('[Export] Error:', err);
    res.status(500).json({ 
      error: process.env.NODE_ENV === 'production' ? 'Export failed' : err.message 
    });
  }
});

module.exports = router;
