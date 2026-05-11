// FILE: app/api/auth/verify/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { shouldUseSecureCookie } from '@/lib/auth/cookie';
import { signToken } from '@/lib/auth/jwt';
import { getSession } from '@/lib/auth/session';
import { getAccountAccessStartupCheck } from '@/lib/auth/account-access-config';
import { resolveAllowedAccountIdsForUser } from '@/lib/auth/account-access';
import { getEffectiveUserRole, getUserById } from '@/lib/models/user';
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

    const effectiveRole = getEffectiveUserRole(dbUser.role, dbUser.email);
    const assignedAccountIds = Array.from(
      await resolveAllowedAccountIdsForUser({
        id: dbUser.id,
        email: dbUser.email,
        role: effectiveRole,
      })
    ).sort((a, b) => a.localeCompare(b));
    const accountAccessCheck = getAccountAccessStartupCheck();

    const response = NextResponse.json({
      authenticated: true,
      user: {
        id: dbUser.id,
        name: dbUser.name,
        email: dbUser.email,
        role: effectiveRole,
        authMode: 'user',
      },
      diagnostics: {
        session: {
          email: session.email ?? null,
          role: session.role ?? null,
          authMode: session.authMode ?? null,
        },
        accountAccess: {
          accountAccessConfigPresent: accountAccessCheck.accountAccessConfigPresent,
          initialAdminEmailsConfigured: accountAccessCheck.initialAdminEmailsConfigured,
          initialAdminEmailsCount: accountAccessCheck.initialAdminEmailsCount,
          userAccountAccessConfigured: accountAccessCheck.userAccountAccessConfigured,
          userAccountAccessMappingCount: accountAccessCheck.userAccountAccessMappingCount,
          mappedAccountIds: assignedAccountIds,
          effectiveRole,
        },
      },
    }, { headers });

    const sessionIsStale =
      session.email !== dbUser.email ||
      session.name !== dbUser.name ||
      session.role !== effectiveRole ||
      session.authMode !== 'user';

    if (sessionIsStale) {
      const token = await signToken({
        userId: dbUser.id,
        role: effectiveRole,
        name: dbUser.name,
        email: dbUser.email,
        authMode: 'user',
      });

      const maxAge = Number.parseInt(process.env.SESSION_MAX_AGE || '86400', 10);
      response.cookies.set('app_session', token, {
        httpOnly: true,
        secure: shouldUseSecureCookie(req),
        sameSite: 'strict',
        path: '/',
        maxAge: Number.isFinite(maxAge) ? maxAge : 86400,
      });
    }

    return response;
  } catch (error) {
    authLogger.warn('auth.verify_hydration_failed', { error, userId: session.userId });
    return NextResponse.json(
      { error: 'Unable to verify session' },
      { status: 503, headers }
    );
  }
}
