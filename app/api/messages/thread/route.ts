import { NextRequest } from 'next/server';
import { authorizeAccountAccess } from '@/lib/auth/account-access';
import {
  badRequest,
  forwardToBackend,
  requireString,
} from '@/lib/server/backend-api';

export async function GET(req: NextRequest) {
  try {
    const accountId = requireString(
      req.nextUrl.searchParams.get('accountId'),
      'accountId'
    );
    const access = await authorizeAccountAccess(req, accountId);
    if (access.response) return access.response;
    const chatId = requireString(
      req.nextUrl.searchParams.get('chatId'),
      'chatId'
    );
    const refresh = req.nextUrl.searchParams.get('refresh') === '1';
    const limit = req.nextUrl.searchParams.get('limit');

    const query = new URLSearchParams({ accountId: access.accountId || accountId, chatId });
    if (refresh) {
      query.set('refresh', '1');
    }
    if (limit) {
      query.set('limit', limit);
    }

    return forwardToBackend({
      method: 'GET',
      path: '/messages/thread',
      query,
    });
  } catch (error) {
    return badRequest(error);
  }
}
