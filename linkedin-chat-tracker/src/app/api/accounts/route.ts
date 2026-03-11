import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { unipile } from '@/lib/unipile';
import { auth } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const accounts = await prisma.linkedInAccount.findMany({
      where: { userId: session.user.id }
    });

    return NextResponse.json(accounts);
  } catch (error: any) {
    return NextResponse.json({ error: error.message, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const body = await req.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: 'Name is required', code: 'BAD_REQUEST' }, { status: 400 });
    }

    const baseUrl = process.env.NEXTAUTH_URL || req.nextUrl.origin;

    const { url: authUrl } = await unipile.generateAuthLink({
      providers: ['LINKEDIN'],
      name,
      success_redirect_url: `${baseUrl}/accounts?connected=1`,
      failure_redirect_url: `${baseUrl}/accounts?error=1`
    });

    return NextResponse.json({ authUrl });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to generate auth link', code: error.code || 'INTERNAL_ERROR' },
      { status: error.status || 500 }
    );
  }
}
