import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getWorkerClient } from '@/lib/worker-client';
import { auth } from '@/lib/auth';

const cookieSchema = z.object({
  name:        z.string().optional(),
  accountName: z.string().min(1),
  cookies:     z.array(z.record(z.unknown())).min(1),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body   = await req.json();
    const parsed = cookieSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payload', details: parsed.error.errors },
        { status: 400 }
      );
    }

    const { accountName, cookies } = parsed.data;

    // Use userId + accountName as the worker accountId (stable, unique per user)
    const workerAccountId = `${session.user.id}-${accountName.toLowerCase().replace(/\s+/g, '-')}`;

    // Import cookies into the worker
    const worker = getWorkerClient();
    await worker.importCookiesRaw(workerAccountId, cookies);

    // Verify the session works
    const verified = await worker.verifySession(workerAccountId).catch(() => ({ ok: false }));

    // Upsert LinkedInAccount in the database
    const account = await prisma.linkedInAccount.upsert({
      where:  { unipileAccountId: workerAccountId },
      update: {
        displayName: accountName,
        status:      verified.ok ? 'ACTIVE' : 'ERROR',
        lastSyncAt:  new Date(),
      },
      create: {
        userId:           session.user.id,
        unipileAccountId: workerAccountId,  // field reused for workerAccountId
        displayName:      accountName,
        status:           verified.ok ? 'ACTIVE' : 'ERROR',
      },
    });

    return NextResponse.json({
      success:   true,
      accountId: account.id,
      verified:  verified.ok,
    });
  } catch (error: unknown) {
    const isDev   = process.env.NODE_ENV === 'development';
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[ImportCookies] Error:', message);
    return NextResponse.json(
      { error: isDev ? message : 'Internal server error' },
      { status: 500 }
    );
  }
}
