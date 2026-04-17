import { NextRequest, NextResponse } from 'next/server';
import { signToken } from '@/lib/auth/jwt';
import { shouldUseSecureCookie } from '@/lib/auth/cookie';
import { verifyPassword } from '@/lib/auth/password';
import { enforceMutationProtection } from '@/lib/server/backend-api';
import { clearLoginAttempts, consumeLoginAttempt } from '@/lib/auth/login-rate-limit';

export async function POST(req: NextRequest) {
  const csrfError = enforceMutationProtection(req);
  if (csrfError) {
    return csrfError;
  }

  try {
    const throttle = await consumeLoginAttempt(req);
    if (!throttle.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please retry later.' },
        {
          status: 429,
          headers: {
            'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
            Pragma: 'no-cache',
            Vary: 'Cookie, Authorization, Origin',
            'Retry-After': String(throttle.retryAfterSec),
          },
        }
      );
    }

    const body = await req.json();
    const { password, rememberMe } = body;
    
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
    
    if (!verifyPassword(String(password), String(dashboardPassword))) {
      return NextResponse.json(
        { error: 'Invalid password' }, 
        { status: 401 }
      );
    }

    await clearLoginAttempts(req);
    
    const sessionName = (process.env.DASHBOARD_USER_NAME || 'Dashboard Admin').trim();
    const sessionEmail = (process.env.DASHBOARD_USER_EMAIL || '').trim();

    // Generate JWT for authenticated session
    const token = await signToken({
      role: 'admin',
      name: sessionName,
      email: sessionEmail || undefined,
    });
    
    // Set HTTP-only cookie
    const response = NextResponse.json({ 
      ok: true, 
      message: 'Login successful',
      user: {
        name: sessionName,
        email: sessionEmail || null,
        role: 'admin',
      },
    });
    response.headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Vary', 'Cookie, Authorization, Origin');

    const cookieOptions: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'strict';
      path: string;
      maxAge?: number;
    } = {
      httpOnly: true,
      secure: shouldUseSecureCookie(req),
      sameSite: 'strict',
      path: '/',
    };

    // If "Remember Me" is checked, persist for configured maxAge.
    // Otherwise browser-session cookie expires on browser close.
    if (rememberMe === true) {
      cookieOptions.maxAge = parseInt(process.env.SESSION_MAX_AGE || '86400', 10);
    }

    response.cookies.set('app_session', token, cookieOptions);

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Login failed' },
      {
        status: 500,
        headers: {
          'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
          Pragma: 'no-cache',
          Vary: 'Cookie, Authorization, Origin',
        },
      }
    );
  }
}
