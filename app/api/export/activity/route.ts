import { NextRequest, NextResponse } from 'next/server';
import { authorizeAccountAccess, authorizeCollectionAccess } from '@/lib/auth/account-access';
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

    const parsedLimit = body?.limit == null ? 1000 : Number.parseInt(String(body.limit), 10);
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 5000) {
      throw new Error('limit must be an integer between 1 and 5000');
    }

    if (accountId) {
      const access = await authorizeAccountAccess(req, accountId);
      if (access.response) return access.response;

      return forwardToBackend({
        method: 'POST',
        path: '/export/activity',
        body: {
          format,
          limit: parsedLimit,
          accountId: access.accountId,
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
        path: '/export/activity',
        body: {
          format,
          limit: parsedLimit,
          accountId: allowedAccountIds[0],
        },
      });
    }

    return forwardToBackend({
      method: 'POST',
      path: '/export/activity',
      body: {
        format,
        limit: parsedLimit,
        ...(accountId ? { accountId } : {}),
      },
    });
  } catch (error) {
    return badRequest(error);
  }
}
