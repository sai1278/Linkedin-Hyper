import { NextRequest, NextResponse } from 'next/server';
import { authorizeAccountAccess, authorizeCollectionAccess } from '@/lib/auth/account-access';
import { forwardToBackend } from '@/lib/server/backend-api';

const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Vary: 'Cookie, Authorization, Origin',
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => undefined) as Record<string, unknown> | undefined;
  const requestedAccountId = String(body?.accountId || '').trim();
  let authorizedBody = body;

  if (requestedAccountId) {
    const access = await authorizeAccountAccess(req, requestedAccountId, { allowApiSecret: true });
    if (access.response) return access.response;
    authorizedBody = {
      ...(body || {}),
      accountId: access.accountId,
    };
  } else {
    const access = await authorizeCollectionAccess(req, { allowApiSecret: true });
    if (access.response) return access.response;

    if (access.actor?.kind === 'user-session' && access.actor.role !== 'admin') {
      const allowedAccountIds = Array.from(access.allowedAccountIds || []);
      if (allowedAccountIds.length === 1) {
        authorizedBody = {
          ...(body || {}),
          accountId: allowedAccountIds[0],
        };
      } else {
        return NextResponse.json(
          { error: 'Forbidden: accountId is required for non-admin sync across multiple accounts' },
          { status: 403, headers: privateHeaders }
        );
      }
    }
  }

  return forwardToBackend({
    method: 'POST',
    path: '/sync/messages',
    body: authorizedBody,
    timeoutMs: 240_000,
  });
}

