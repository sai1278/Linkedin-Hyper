import { NextRequest, NextResponse } from 'next/server';
import { authenticateCaller } from '@/lib/server/backend-api';

export async function POST(req: NextRequest) {
  const authError = await authenticateCaller(req);
  if (authError) return authError;

  return NextResponse.json(
    {
      error: 'This route is deprecated. Use /api/messages/send-new with profileUrl or chatId.',
      code: 'SEND_ROUTE_DEPRECATED',
    },
    { status: 410 }
  );
}
