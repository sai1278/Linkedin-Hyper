import { NextRequest } from 'next/server';
import { authorizeAccountAccess } from '@/lib/auth/account-access';
import { forwardToBackend } from '@/lib/server/backend-api';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: accountId } = await params;
  const access = await authorizeAccountAccess(req, accountId, { allowApiSecret: true });
  if (access.response) return access.response;

  return forwardToBackend({
    method: 'GET',
    path: `/accounts/${access.accountId}/session/status`,
  });
}
