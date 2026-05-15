'use strict';

function createAccountRegistry(deps) {
  const {
    listKnownAccountIds,
    accountRepo,
    withTimeout,
    isDatabaseUnavailable,
    validateId,
    dbReadTimeoutMs,
  } = deps;

  async function getKnownAccountIdsSet() {
    const ids = new Set(
      (await listKnownAccountIds())
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );

    try {
      const dbAccounts = await withTimeout(accountRepo.getAllAccounts(), dbReadTimeoutMs);
      for (const account of dbAccounts || []) {
        const id = String(account?.id || '').trim();
        if (id) ids.add(id);
      }
    } catch (err) {
      if (!isDatabaseUnavailable(err)) {
        throw err;
      }
      if (ids.size === 0) {
        const lookupErr = new Error('Account registry is unavailable. Retry after database connectivity is restored.');
        lookupErr.status = 503;
        lookupErr.code = 'ACCOUNT_LOOKUP_UNAVAILABLE';
        throw lookupErr;
      }
    }

    return ids;
  }

  async function assertKnownAccountId(accountId) {
    const normalizedAccountId = validateId(accountId, { field: 'accountId' });
    const knownIds = await getKnownAccountIdsSet();
    if (knownIds.has(normalizedAccountId)) {
      return normalizedAccountId;
    }

    const err = new Error(`Unknown accountId: ${normalizedAccountId}`);
    err.status = 404;
    err.code = 'UNKNOWN_ACCOUNT';
    throw err;
  }

  async function assertConversationBelongsToAccount(accountId, conversationId) {
    const rawChatId = validateId(conversationId, { field: 'chatId' });
    const normalizedChatId = deps.normalizeThreadId(accountId, rawChatId);

    if (normalizedChatId.startsWith('activity-') || normalizedChatId === 'new') {
      return normalizedChatId;
    }

    let conversation = null;

    try {
      conversation = await withTimeout(deps.messageRepo.getConversationById(rawChatId), dbReadTimeoutMs);
      if (!conversation && normalizedChatId !== rawChatId) {
        conversation = await withTimeout(deps.messageRepo.getConversationById(normalizedChatId), dbReadTimeoutMs);
      }
    } catch (err) {
      if (!isDatabaseUnavailable(err)) {
        throw err;
      }
      const lookupErr = new Error('Conversation lookup unavailable. Retry after database connectivity is restored.');
      lookupErr.status = 503;
      lookupErr.code = 'CONVERSATION_LOOKUP_UNAVAILABLE';
      throw lookupErr;
    }

    if (!conversation) {
      const err = new Error(`Unknown chatId for account ${accountId}`);
      err.status = 404;
      err.code = 'UNKNOWN_CHAT';
      throw err;
    }

    if (String(conversation.accountId || '') !== String(accountId)) {
      const err = new Error(`chatId does not belong to account ${accountId}`);
      err.status = 403;
      err.code = 'CHAT_ACCOUNT_MISMATCH';
      throw err;
    }

    return normalizedChatId;
  }

  return {
    getKnownAccountIdsSet,
    assertKnownAccountId,
    assertConversationBelongsToAccount,
  };
}

module.exports = {
  createAccountRegistry,
};
