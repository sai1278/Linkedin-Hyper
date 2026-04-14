import { NextRequest } from 'next/server';
import { authenticateCaller, forwardToBackend } from '@/lib/server/backend-api';

export async function POST(req: NextRequest) {
  const authError = authenticateCaller(req);
  if (authError) return authError;

  return forwardToBackend({
    method: 'POST',
    path: '/sync/messages',
    timeoutMs: 120_000,
  });
}
