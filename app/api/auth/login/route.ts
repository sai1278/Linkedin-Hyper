import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { signToken } from '@/lib/auth/jwt';
import { shouldUseSecureCookie } from '@/lib/auth/cookie';
import { enforceMutationProtection } from '@/lib/server/backend-api';
import { clearLoginAttempts, consumeLoginAttempt } from '@/lib/auth/login-rate-limit';
import { getUserByEmail } from '@/lib/models/user';
import { serverLogger } from '@/lib/server/logger';

const authLogger = serverLogger.child({ route: '/api/auth/login' });

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
    const { email, password, rememberMe } = body;

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedPassword = String(password || '');

    if (!normalizedEmail || !normalizedPassword) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const existingUser = await getUserByEmail(normalizedEmail);
    if (!existingUser) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const isValidUserPassword = await bcrypt.compare(
      normalizedPassword,
      String(existingUser.password_hash || '')
    );
    if (!isValidUserPassword) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    await clearLoginAttempts(req);

    const token = await signToken({
      userId: existingUser.id,
      role: existingUser.role,
      name: existingUser.name,
      email: existingUser.email,
      authMode: 'user',
    });
    
    // Set HTTP-only cookie
    const response = NextResponse.json({ 
      ok: true, 
      message: 'Login successful',
      user: {
        id: existingUser.id,
        name: existingUser.name,
        email: existingUser.email,
        role: existingUser.role,
        authMode: 'user',
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
    authLogger.error('auth.login_failed', { error });
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
