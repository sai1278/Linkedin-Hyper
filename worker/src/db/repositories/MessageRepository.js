// FILE: worker/src/db/repositories/MessageRepository.js
// Repository for Conversation and Message database operations

'use strict';

const { getPrisma } = require('../prisma');

class MessageRepository {
  normalizeMessageText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Upsert a conversation (create if not exists, update if exists)
   * @param {Object} data - Conversation data
   * @returns {Promise<Object>} Conversation object
   */
  async upsertConversation(data) {
    const prisma = getPrisma();
    
    const {
      id,
      accountId,
      participantName,
      participantProfileUrl,
      participantAvatarUrl,
      lastMessageAt,
      lastMessageText,
      lastMessageSentByMe,
    } = data;

    return await prisma.conversation.upsert({
      where: { id },
      update: {
        participantName,
        participantProfileUrl,
        participantAvatarUrl,
        lastMessageAt,
        lastMessageText,
        lastMessageSentByMe,
        updatedAt: new Date(),
      },
      create: {
        id,
        accountId,
        participantName,
        participantProfileUrl: participantProfileUrl || null,
        participantAvatarUrl: participantAvatarUrl || null,
        lastMessageAt,
        lastMessageText,
        lastMessageSentByMe,
      },
    });
  }

  /**
   * Upsert a message (create if not exists, ignore if duplicate)
   * Uses composite unique constraint: conversationId + sentAt + text
   * @param {Object} data - Message data
   * @returns {Promise<Object>} Message object
   */
  async upsertMessage(data) {
    const prisma = getPrisma();
    
    const {
      conversationId,
      accountId,
      senderId,
      senderName,
      text,
      sentAt,
      isSentByMe,
      linkedinMessageId,
      timestampInferred = false,
    } = data;

    const normalizedText = this.normalizeMessageText(text);
    const normalizedSentAt = new Date(sentAt);
    const sentAtDate = Number.isNaN(normalizedSentAt.getTime()) ? new Date() : normalizedSentAt;
    const stableLinkedinMessageId = String(linkedinMessageId || '').trim() || null;

    try {
      if (stableLinkedinMessageId) {
        const existingByLinkedinId = await prisma.message.findFirst({
          where: {
            accountId,
            conversationId,
            linkedinMessageId: stableLinkedinMessageId,
          },
        });

        if (existingByLinkedinId) {
          await prisma.message.update({
            where: { id: existingByLinkedinId.id },
            data: {
              senderName,
              linkedinMessageId: stableLinkedinMessageId,
            },
          });
          console.log(
            `[MessageRepository] Duplicate skipped by linkedinMessageId for conversation ${conversationId}: ${stableLinkedinMessageId}`
          );
          return null;
        }
      }

      if (timestampInferred) {
        const duplicateWindowMs = 60 * 1000;
        const existingNearMatch = await prisma.message.findFirst({
          where: {
            accountId,
            conversationId,
            senderId,
            text: normalizedText,
            sentAt: {
              gte: new Date(sentAtDate.getTime() - duplicateWindowMs),
              lte: new Date(sentAtDate.getTime() + duplicateWindowMs),
            },
          },
          orderBy: { sentAt: 'asc' },
        });

        if (existingNearMatch) {
          await prisma.message.update({
            where: { id: existingNearMatch.id },
            data: {
              senderName,
              linkedinMessageId: stableLinkedinMessageId || existingNearMatch.linkedinMessageId,
            },
          });
          console.log(
            `[MessageRepository] Duplicate skipped by inferred-time fuzzy match for conversation ${conversationId}: sender=${senderId} sentAt=${sentAtDate.toISOString()}`
          );
          return null;
        }
      }

      return await prisma.message.upsert({
        where: {
          conversationId_sentAt_text: {
            conversationId,
            sentAt: sentAtDate,
            text: normalizedText,
          },
        },
        update: {
          // Update metadata if needed (typically we don't update messages)
          senderName,
          linkedinMessageId: stableLinkedinMessageId || undefined,
        },
        create: {
          conversationId,
          accountId,
          senderId,
          senderName,
          text: normalizedText,
          sentAt: sentAtDate,
          isSentByMe,
          linkedinMessageId: stableLinkedinMessageId,
        },
      });
    } catch (error) {
      // If message already exists with same timestamp and text, just skip
      if (error.code === 'P2002') {
        console.log(`[MessageRepository] Duplicate message skipped for conversation ${conversationId}`);
        return null;
      }
      throw error;
    }
  }

  /**
   * Get conversations by account with pagination
   * @param {string} accountId - Account ID
   * @param {number} limit - Number of conversations to return
   * @param {number} offset - Offset for pagination
   * @returns {Promise<Array>} Array of conversations
   */
  async getConversationsByAccount(accountId, limit = 50, offset = 0) {
    const prisma = getPrisma();
    
    return await prisma.conversation.findMany({
      where: { accountId },
      orderBy: { lastMessageAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Get all conversations (unified inbox)
   * @param {number} limit - Number of conversations to return
   * @param {number} offset - Offset for pagination
   * @returns {Promise<Array>} Array of conversations with account info
   */
  async getAllConversations(limit = 100, offset = 0) {
    const prisma = getPrisma();
    
    return await prisma.conversation.findMany({
      include: {
        account: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Get all conversations with full persisted message history.
   * Used by the unified inbox API so refreshes can rebuild the same thread state
   * from the database instead of falling back to preview-only rows.
   * @param {number} limit - Number of conversations to return
   * @param {number} offset - Offset for pagination
   * @returns {Promise<Array>} Array of conversations with messages
   */
  async getAllConversationsWithMessages(limit = 100, offset = 0) {
    const prisma = getPrisma();

    return await prisma.conversation.findMany({
      include: {
        account: {
          select: {
            id: true,
            displayName: true,
          },
        },
        messages: {
          orderBy: { sentAt: 'asc' },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Get messages by conversation with pagination
   * @param {string} conversationId - Conversation ID
   * @param {number} limit - Number of messages to return
   * @param {number} offset - Offset for pagination
   * @returns {Promise<Array>} Array of messages
   */
  async getMessagesByConversation(conversationId, limit = 100, offset = 0) {
    const prisma = getPrisma();
    
    return await prisma.message.findMany({
      where: { conversationId },
      orderBy: { sentAt: 'asc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Get recent messages for an account since a timestamp
   * @param {string} accountId - Account ID
   * @param {Date} since - Timestamp to filter from
   * @returns {Promise<Array>} Array of messages
   */
  async getRecentMessages(accountId, since) {
    const prisma = getPrisma();
    
    return await prisma.message.findMany({
      where: {
        accountId,
        sentAt: {
          gte: since,
        },
      },
      orderBy: { sentAt: 'desc' },
    });
  }

  /**
   * Update conversation's last message info
   * @param {string} conversationId - Conversation ID
   * @param {Object} lastMessage - Last message data
   * @returns {Promise<Object>} Updated conversation
   */
  async updateConversationLastMessage(conversationId, lastMessage) {
    const prisma = getPrisma();
    
    return await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(lastMessage.sentAt),
        lastMessageText: lastMessage.text,
        lastMessageSentByMe: lastMessage.sentByMe,
      },
    });
  }

  /**
   * Get conversation by ID
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object|null>} Conversation or null
   */
  async getConversationById(conversationId) {
    const prisma = getPrisma();
    
    return await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
  }

  /**
   * Count total conversations for an account
   * @param {string} accountId - Account ID
   * @returns {Promise<number>} Count of conversations
   */
  async countConversationsByAccount(accountId) {
    const prisma = getPrisma();
    
    return await prisma.conversation.count({
      where: { accountId },
    });
  }

  /**
   * Count total messages for a conversation
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<number>} Count of messages
   */
  async countMessagesByConversation(conversationId) {
    const prisma = getPrisma();
    
    return await prisma.message.count({
      where: { conversationId },
    });
  }

  /**
   * Delete old messages (cleanup) - optional retention policy
   * @param {number} retentionDays - Number of days to keep messages
   * @returns {Promise<number>} Number of deleted messages
   */
  async deleteOldMessages(retentionDays) {
    const prisma = getPrisma();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await prisma.message.deleteMany({
      where: {
        sentAt: {
          lt: cutoffDate,
        },
      },
    });

    return result.count;
  }

  /**
   * Get messages for export (all messages for an account or conversation)
   * @param {Object} options - Filter options
   * @returns {Promise<Array>} Array of messages with conversation info
   */
  async getMessagesForExport(options = {}) {
    const prisma = getPrisma();
    const { accountId, conversationId, limit, offset } = options;

    const where = {};
    if (accountId) where.accountId = accountId;
    if (conversationId) where.conversationId = conversationId;

    return await prisma.message.findMany({
      where,
      include: {
        conversation: {
          select: {
            participantName: true,
            participantProfileUrl: true,
          },
        },
      },
      orderBy: { sentAt: 'asc' },
      take: limit,
      skip: offset,
    });
  }
}

module.exports = new MessageRepository();
