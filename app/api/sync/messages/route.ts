import { NextRequest } from 'next/server';
import { authenticateCaller, forwardToBackend } from '@/lib/server/backend-api';

export async function POST(req: NextRequest) {
  const authError = await authenticateCaller(req, { allowApiSecret: true });
  if (authError) return authError;

  const body = await req.json().catch(() => undefined);

  return forwardToBackend({
    method: 'POST',
    path: '/sync/messages',
    body,
    timeoutMs: 240_000,
  });
}

