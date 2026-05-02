// FILE: app/api/accounts/[id]/verify/route.ts
import { NextRequest } from 'next/server';
import { authenticateCaller, forwardToBackend } from '@/lib/server/backend-api';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await authenticateCaller(req, { allowApiSecret: true });
  if (authError) return authError;
  
  const { id: accountId } = await params;
  const query = new URLSearchParams();
  const fresh = req.nextUrl.searchParams.get('fresh');
  if (fresh) {
    query.set('fresh', fresh);
  }
  
  // This endpoint takes 10-30 seconds as it launches a browser
  return forwardToBackend({
    method: 'POST',
    path: `/accounts/${accountId}/verify`,
    query,
    // Verify can now take longer because we wait for feed/messaging auth state to settle.
    timeoutMs: 420_000,
  });
}
