import { NextRequest, NextResponse } from 'next/server';
import { authorizeCollectionAccess, filterAccountScopedPayload } from '@/lib/auth/account-access';
import { fetchBackendResponse, forwardToBackend } from '@/lib/server/backend-api';

const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Vary: 'Cookie, Authorization, Origin',
};

export async function GET(req: NextRequest) {
  const access = await authorizeCollectionAccess(req);
  if (access.response) return access.response;

  if (access.actor?.kind === 'user-session' && access.actor.role !== 'admin') {
    try {
      const upstream = await fetchBackendResponse({
        method: 'GET',
        path: '/inbox/unified',
        query: req.nextUrl.searchParams,
      });
      const payload = await upstream.json().catch(() => null) as
        | { conversations?: Array<{ accountId?: string }>; stale?: boolean; degraded?: boolean }
        | null;

      if (!upstream.ok || !payload) {
        return NextResponse.json(
          payload ?? { error: 'Backend unreachable' },
          {
            status: upstream.status || 502,
            headers: privateHeaders,
          }
        );
      }

      const filteredConversations = filterAccountScopedPayload(
        Array.isArray(payload.conversations) ? payload.conversations : [],
        access.allowedAccountIds || new Set<string>()
      );

      return NextResponse.json(
        {
          ...payload,
          conversations: filteredConversations,
        },
        {
          status: upstream.status,
          headers: privateHeaders,
        }
      );
    } catch {
      return NextResponse.json(
        { error: 'Backend unreachable' },
        { status: 502, headers: privateHeaders }
      );
    }
  }

  return forwardToBackend({
    method: 'GET',
    path: '/inbox/unified',
    query: req.nextUrl.searchParams,
  });
}
