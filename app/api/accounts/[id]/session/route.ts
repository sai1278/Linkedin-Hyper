// FILE: app/api/accounts/[id]/session/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeAccountAccess } from '@/lib/auth/account-access';
import { forwardToBackend, badRequest } from '@/lib/server/backend-api';
import { validateLinkedInCookies } from '@/lib/validators/cookie-validator';

// POST - Import session cookies
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: accountId } = await params;
    const access = await authorizeAccountAccess(req, accountId, { allowApiSecret: true });
    if (access.response) return access.response;
    const cookies = await req.json();

    // Validate cookies
    const validation = validateLinkedInCookies(cookies);
    if (!validation.isValid) {
      return NextResponse.json(
        { 
          error: 'Invalid cookies', 
          details: validation.errors,
          warnings: validation.warnings 
        },
        { status: 400 }
      );
    }
    
    // Forward to worker
    return forwardToBackend({
      method: 'POST',
      path: `/accounts/${access.accountId}/session`,
      body: cookies,
    });
  } catch (err) {
    return badRequest(err);
  }
}

// DELETE - Remove session cookies
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: accountId } = await params;
  const access = await authorizeAccountAccess(req, accountId, { allowApiSecret: true });
  if (access.response) return access.response;

  return forwardToBackend({
    method: 'DELETE',
    path: `/accounts/${access.accountId}/session`,
  });
}
