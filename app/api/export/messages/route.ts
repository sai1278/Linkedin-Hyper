import { NextRequest } from 'next/server';
import { authenticateCaller, forwardToBackend } from '@/lib/server/backend-api';

export async function POST(req: NextRequest) {
  const authError = authenticateCaller(req);
  if (authError) return authError;

  const body = await req.json();
  
  return forwardToBackend({ 
    method: 'POST', 
    path: '/export/messages',
    body,
  });
}
