import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { signToken } from '@/lib/auth/jwt';
import { shouldUseSecureCookie } from '@/lib/auth/cookie';
import { verifyPassword } from '@/lib/auth/password';
import { isLegacyAuthAllowed, isProductionRuntime } from '@/lib/auth/runtime';
import { enforceMutationProtection } from '@/lib/server/backend-api';
import { clearLoginAttempts, consumeLoginAttempt } from '@/lib/auth/login-rate-limit';
import { getUserByEmail } from '@/lib/models/user';

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
    
    if (!password) {
      return NextResponse.json(
        { error: 'Password is required' }, 
        { status: 400 }
      );
    }
    
    const normalizedEmail = String(email || '').trim().toLowerCase();

    let sessionUser: {
      userId?: string;
      name: string;
      email?: string;
      role: 'admin' | 'user';
      mode: 'user' | 'legacy';
    } | null = null;

    if (normalizedEmail) {
      const existingUser = await getUserByEmail(normalizedEmail);
      if (existingUser) {
        const isValidUserPassword = await bcrypt.compare(String(password), String(existingUser.password_hash || ''));
        if (!isValidUserPassword) {
          return NextResponse.json(
            { error: 'Invalid email or password' },
            { status: 401 }
          );
        }

        sessionUser = {
          userId: existingUser.id,
          name: existingUser.name,
          email: existingUser.email,
          role: existingUser.role,
          mode: 'user',
        };
      }
    }

    if (!sessionUser) {
      if (!isLegacyAuthAllowed()) {
        console.warn('[auth/login] Legacy shared-password login blocked in production. Migrate operator to DB-backed user or set ALLOW_LEGACY_AUTH=true temporarily.');
        return NextResponse.json(
          { error: 'Legacy shared-password login is disabled in production' },
          { status: 403 }
        );
      }

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

      const sessionName = (process.env.DASHBOARD_USER_NAME || 'Dashboard Admin').trim();
      const sessionEmail = (process.env.DASHBOARD_USER_EMAIL || '').trim();

      // TODO(auth-migration): Remove shared-password fallback after all operators are migrated to DB-backed users.
      console.warn(
        `[auth/login] Legacy shared-password login used${isProductionRuntime() ? ' in production' : ''}; migrate operator to registered user account.`
      );
      sessionUser = {
        name: sessionName,
        email: sessionEmail || undefined,
        role: 'admin',
        mode: 'legacy',
      };
    }

    await clearLoginAttempts(req);

    const token = await signToken({
      ...(sessionUser.userId ? { userId: sessionUser.userId } : {}),
      role: sessionUser.role,
      name: sessionUser.name,
      email: sessionUser.email || undefined,
      authMode: sessionUser.mode,
    });
    
    // Set HTTP-only cookie
    const response = NextResponse.json({ 
      ok: true, 
      message: 'Login successful',
      user: {
        id: sessionUser.userId || null,
        name: sessionUser.name,
        email: sessionUser.email || null,
        role: sessionUser.role,
        authMode: sessionUser.mode,
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
