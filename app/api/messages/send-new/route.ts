// FILE: app/api/messages/send-new/route.ts
import { NextRequest } from 'next/server';
import { authorizeAccountAccess } from '@/lib/auth/account-access';
import { forwardToBackend, badRequest } from '@/lib/server/backend-api';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const accountId = String(body?.accountId || '').trim();
    const profileUrl = String(body?.profileUrl || '').trim();
    const chatId = String(body?.chatId || '').trim();
    const text = String(body?.text || '');

    if (!accountId || !text) {
      return badRequest(new Error('Missing required fields: accountId, text'));
    }

    const access = await authorizeAccountAccess(req, accountId);
    if (access.response) return access.response;

    if (!profileUrl && !chatId) {
      return badRequest(new Error('Either profileUrl or chatId is required'));
    }

    // Validate message length
    if (text.length > 3000) {
      return badRequest(new Error('Message must be 3000 characters or less'));
    }

    return forwardToBackend({
      method: 'POST',
      path: '/messages/send-new',
      body: {
        accountId: access.accountId,
        text,
        ...(profileUrl ? { profileUrl } : {}),
        ...(chatId ? { chatId } : {}),
      },
      // send-new can perform profile flow + thread fallback; allow a longer upstream window.
      timeoutMs: 240_000,
    });
  } catch (err) {
    return badRequest(err);
  }
}
