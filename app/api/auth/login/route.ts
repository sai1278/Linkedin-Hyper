// FILE: app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword } from '@/lib/auth/password';
import { signToken } from '@/lib/auth/jwt';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password } = body;
    
    const expectedPassword = process.env.DASHBOARD_PASSWORD;
    if (!expectedPassword) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }
    
    // Timing-safe password comparison
    const isValid = verifyPassword(password, expectedPassword);
    
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid password' },
        { status: 401 }
      );
    }
    
    // Generate JWT
    const token = await signToken();
    
    // Set HTTP-only cookie
    const response = NextResponse.json({ ok: true });
    
    response.cookies.set('app_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: parseInt(process.env.SESSION_MAX_AGE || '86400', 10),
      path: '/',
    });
    
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    );
  }
}
