import { NextRequest, NextResponse } from 'next/server';
import { signToken } from '@/lib/auth/jwt';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password } = body;
    
    if (!password) {
      return NextResponse.json(
        { error: 'Password is required' }, 
        { status: 400 }
      );
    }
    
    // Validate against DASHBOARD_PASSWORD
    const dashboardPassword = process.env.DASHBOARD_PASSWORD;
    if (!dashboardPassword) {
      console.error('DASHBOARD_PASSWORD environment variable is not set');
      return NextResponse.json(
        { error: 'Server configuration error' }, 
        { status: 500 }
      );
    }
    
    if (password !== dashboardPassword) {
      return NextResponse.json(
        { error: 'Invalid password' }, 
        { status: 401 }
      );
    }
    
    // Generate JWT for authenticated session
    const token = await signToken({ role: 'admin' });
    
    // Set HTTP-only cookie
    const response = NextResponse.json({ 
      ok: true, 
      message: 'Login successful' 
    });
    
    response.cookies.set('app_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: parseInt(process.env.SESSION_MAX_AGE || '86400', 10),
      path: '/',
    });
    
    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    );
  }
}
