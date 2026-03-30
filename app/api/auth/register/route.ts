import { NextRequest, NextResponse } from 'next/server';
import { signToken } from '@/lib/auth/jwt';
import { createUser, getUserByEmail } from '@/lib/models/user';
import bcrypt from 'bcrypt';
import { shouldUseSecureCookie } from '@/lib/auth/cookie';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, password } = body;
    
    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email, and password are required' }, 
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' }, 
        { status: 400 }
      );
    }
    
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' }, 
        { status: 409 }
      );
    }
    
    // Hash password
    const password_hash = await bcrypt.hash(password, 12);
    
    // Create new user (automatically set as role 'user')
    const user = await createUser({
      name,
      email,
      password_hash,
      role: 'user'
    });
    
    // Generate JWT specific to the user
    const token = await signToken({ userId: user.id, role: user.role });
    
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
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Registration failed' },
      { status: 500 }
    );
  }
}
