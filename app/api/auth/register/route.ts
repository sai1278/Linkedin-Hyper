import { NextRequest, NextResponse } from 'next/server';
import { signToken } from '@/lib/auth/jwt';
import { createUser, getUserByEmail } from '@/lib/models/user';
import bcrypt from 'bcrypt';
import { shouldUseSecureCookie } from '@/lib/auth/cookie';
import { enforceMutationProtection } from '@/lib/server/backend-api';
import { serverLogger } from '@/lib/server/logger';

const authLogger = serverLogger.child({ route: '/api/auth/register' });

function getInitialAdminEmails(): Set<string> {
  return new Set(
    String(process.env.INITIAL_ADMIN_EMAILS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function POST(req: NextRequest) {
  const csrfError = enforceMutationProtection(req);
  if (csrfError) {
    return csrfError;
  }

  try {
    const body = await req.json();
    const { name, email, password } = body;

    const normalizedName = String(name || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedPassword = String(password || '');

    if (!normalizedName || !normalizedEmail || !normalizedPassword) {
      return NextResponse.json(
        { error: 'Name, email, and password are required' }, 
        { status: 400 }
      );
    }

    if (normalizedPassword.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' }, 
        { status: 400 }
      );
    }

    const existingUser = await getUserByEmail(normalizedEmail);
    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' }, 
        { status: 409 }
      );
    }

    const password_hash = await bcrypt.hash(normalizedPassword, 12);
    const initialAdminEmails = getInitialAdminEmails();
    const assignedRole = initialAdminEmails.has(normalizedEmail) ? 'admin' : 'user';

    const user = await createUser({
      name: normalizedName,
      email: normalizedEmail,
      password_hash,
      role: assignedRole,
    });

    const token = await signToken({
      userId: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      authMode: 'user',
    });
    
    const response = NextResponse.json({ 
      ok: true, 
      user: { id: user.id, name: user.name, email: user.email, role: user.role } 
    }, { status: 201 });
    
    // Set HTTP-only cookie
    response.cookies.set('app_session', token, {
      httpOnly: true,
      secure: shouldUseSecureCookie(req),
      sameSite: 'strict',
      maxAge: parseInt(process.env.SESSION_MAX_AGE || '86400', 10),
      path: '/',
    });
    
    return response;
  } catch (error) {
    authLogger.error('auth.register_failed', { error });
    return NextResponse.json(
      { error: 'Registration failed' },
      { status: 500 }
    );
  }
}
