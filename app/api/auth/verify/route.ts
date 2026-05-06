// FILE: app/api/auth/verify/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getUserById } from '@/lib/models/user';
import { serverLogger } from '@/lib/server/logger';

const authLogger = serverLogger.child({ route: '/api/auth/verify' });

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const headers = {
    'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
    Pragma: 'no-cache',
    Vary: 'Cookie, Authorization, Origin',
  };
  
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401, headers });
  }
  
  if (!session.userId) {
    return NextResponse.json({ authenticated: false }, { status: 401, headers });
  }

  try {
    const dbUser = await getUserById(session.userId);
    if (!dbUser) {
      return NextResponse.json({ authenticated: false }, { status: 401, headers });
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: dbUser.id,
        name: dbUser.name,
        email: dbUser.email,
        role: dbUser.role,
        authMode: 'user',
      },
    }, { headers });
  } catch (error) {
    authLogger.warn('auth.verify_hydration_failed', { error, userId: session.userId });
    return NextResponse.json(
      { error: 'Unable to verify session' },
      { status: 503, headers }
    );
  }
}
