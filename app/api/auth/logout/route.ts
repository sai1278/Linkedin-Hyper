// FILE: app/api/auth/logout/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSession, blacklistToken } from '@/lib/auth/session';

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    
    // Blacklist the token if it has a JTI
    if (session?.jti) {
      const ttl = session.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await blacklistToken(session.jti, ttl);
      }
    }
    
    const response = NextResponse.json({ ok: true });
    
    // Clear the cookie
    response.cookies.set('app_session', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 0,
      path: '/',
    });
    
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: 'Logout failed' },
      { status: 500 }
    );
  }
}
