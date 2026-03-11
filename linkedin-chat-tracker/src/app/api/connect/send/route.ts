import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { unipile } from '@/lib/unipile';
import { auth } from '@/lib/auth';

const sendConnectionSchema = z.object({
  accountId: z.string(),
  userId: z.string(),
  note: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const body = await req.json();
    const result = sendConnectionSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid payload', code: 'VALIDATION_ERROR', details: result.error.errors },
        { status: 400 }
      );
    }

    const { accountId, userId, note } = result.data;

    const account = await prisma.linkedInAccount.findFirst({
      where: { id: accountId, userId: session.user.id }
    });

    if (!account) {
      return NextResponse.json({ error: 'Account not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    await unipile.sendConnectionRequest(account.unipileAccountId, userId, note);

    await prisma.activityLog.create({
      data: {
        accountId: account.id,
        action: 'CONNECTION_SENT',
        metadata: {
          userId,
          note
        }
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const isDev = process.env.NODE_ENV === 'development'
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('[Connect POST] Error:', message)
    return NextResponse.json(
      { error: isDev ? message : 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: error instanceof Error && 'status' in error ? (error as any).status || 500 : 500 }
    )
  }
}
