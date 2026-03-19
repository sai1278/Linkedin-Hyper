import { NextRequest } from 'next/server';
import {
  authenticateCaller,
  badRequest,
  forwardToBackend,
  requireString,
} from '@/lib/server/backend-api';

export async function GET(req: NextRequest) {
  const authError = authenticateCaller(req);
  if (authError) return authError;

  try {
    const accountId = requireString(
      req.nextUrl.searchParams.get('accountId'),
      'accountId'
    );
    const chatId = requireString(
      req.nextUrl.searchParams.get('chatId'),
      'chatId'
    );

    return forwardToBackend({
      method: 'GET',
      path: '/messages/thread',
      query: new URLSearchParams({ accountId, chatId }),
    });
  } catch (error) {
    return badRequest(error);
  }
}
