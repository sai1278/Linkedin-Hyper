import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { unipile } from '@/lib/unipile';
import { auth } from '@/lib/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const account = await prisma.linkedInAccount.findFirst({
      where: { 
        id: params.id,
        userId: session.user.id 
      }
    });

    if (!account) {
      return NextResponse.json({ error: 'Account not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json(account);
  } catch (error: any) {
    return NextResponse.json({ error: error.message, code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const account = await prisma.linkedInAccount.findFirst({
      where: { 
        id: params.id,
        userId: session.user.id 
      }
    });

    if (!account) {
      return NextResponse.json({ error: 'Account not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    await unipile.deleteAccount(account.unipileAccountId);

    await prisma.linkedInAccount.delete({
      where: { id: account.id }
    });

    return new NextResponse(null, { status: 204 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to delete account', code: error.code || 'INTERNAL_ERROR' },
      { status: error.status || 500 }
    );
  }
}
