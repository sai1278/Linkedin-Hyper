// FILE: app/api/auth/verify/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getUserById } from '@/lib/models/user';

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
  
  const fallbackName = session.name || process.env.DASHBOARD_USER_NAME || 'Dashboard Admin';
  const fallbackEmail = session.email || process.env.DASHBOARD_USER_EMAIL || null;

  let user = {
    id: session.userId || null,
    name: fallbackName,
    email: fallbackEmail,
    role: session.role || 'admin',
  };

  if (session.userId) {
    try {
      const dbUser = await getUserById(session.userId);
      if (dbUser) {
        user = {
          id: dbUser.id,
          name: dbUser.name,
          email: dbUser.email,
          role: dbUser.role,
        };
      }
    } catch (error) {
      console.warn('[auth/verify] Failed to hydrate session user from DB:', error);
    }
  }

  return NextResponse.json({ authenticated: true, user }, { headers });
}
