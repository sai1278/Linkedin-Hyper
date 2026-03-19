// FILE: app/api/accounts/[id]/limits/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authenticateCaller, forwardToBackend } from '@/lib/server/backend-api';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = authenticateCaller(req);
  if (authError) return authError;
  
  const { id: accountId } = await params;
  
  return forwardToBackend({
    method: 'GET',
    path: `/accounts/${accountId}/limits`,
  });
}
