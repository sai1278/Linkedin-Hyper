import { NextRequest, NextResponse } from 'next/server';
import {
  authorizeAccountAccess,
  authorizeCollectionAccess,
  authorizeConversationAccess,
} from '@/lib/auth/account-access';
import { badRequest, forwardToBackend } from '@/lib/server/backend-api';

const ID_RE = /^[a-zA-Z0-9._:-]{1,128}$/;
const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Vary: 'Cookie, Authorization, Origin',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const format = String(body?.format || 'csv').toLowerCase();
    if (!['csv', 'json'].includes(format)) {
      throw new Error('Invalid format. Allowed values: csv, json');
    }

    const accountId = body?.accountId ? String(body.accountId).trim() : undefined;
    if (accountId && !ID_RE.test(accountId)) {
      throw new Error('Invalid accountId');
    }

    // Backward-compatible alias: frontend may still send chatId.
    const conversationIdRaw = body?.conversationId ?? body?.chatId;
    const conversationId = conversationIdRaw ? String(conversationIdRaw).trim() : undefined;
    if (conversationId && !ID_RE.test(conversationId)) {
      throw new Error('Invalid conversationId');
    }

    if (accountId) {
      const access = await authorizeAccountAccess(req, accountId);
      if (access.response) return access.response;
      return forwardToBackend({
        method: 'POST',
        path: '/export/messages',
        body: {
          format,
          accountId: access.accountId,
          ...(conversationId ? { conversationId } : {}),
        },
      });
    }

    if (conversationId) {
      const access = await authorizeConversationAccess(req, conversationId);
      if (access.response) return access.response;
      return forwardToBackend({
        method: 'POST',
        path: '/export/messages',
        body: {
          format,
          accountId: access.accountId,
          conversationId: access.conversationId,
        },
      });
    }

    const collectionAccess = await authorizeCollectionAccess(req);
    if (collectionAccess.response) return collectionAccess.response;
    if (collectionAccess.actor?.kind === 'user-session' && collectionAccess.actor.role !== 'admin') {
      const allowedAccountIds = Array.from(collectionAccess.allowedAccountIds || []);
      if (allowedAccountIds.length !== 1) {
        return NextResponse.json(
          { error: 'Forbidden: accountId is required for non-admin exports across multiple accounts' },
          { status: 403, headers: privateHeaders }
        );
      }

      return forwardToBackend({
        method: 'POST',
        path: '/export/messages',
        body: {
          format,
          accountId: allowedAccountIds[0],
        },
      });
    }

    return forwardToBackend({
      method: 'POST',
      path: '/export/messages',
      body: {
        format,
        ...(accountId ? { accountId } : {}),
        ...(conversationId ? { conversationId } : {}),
      },
    });
  } catch (error) {
    return badRequest(error);
  }
}
