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

    const conversationId = params.id;
    const cursor = req.nextUrl.searchParams.get('cursor') || undefined;

    const conversation = await prisma.conversation.findFirst({
      where: { 
        id: conversationId,
        account: { userId: session.user.id }
      },
      include: { account: true }
    });

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const paginatedMessages = await unipile.getMessages(conversation.unipileChatId, cursor);

    // Upsert each Message in Prisma
    for (const msg of paginatedMessages.items) {
      const direction: 'OUTBOUND' | 'INBOUND' = 
        msg.sender_id && msg.sender_id === conversation.account.unipileAccountId
          ? 'OUTBOUND'
          : 'INBOUND';

      await prisma.message.upsert({
        where: { unipileMessageId: msg.id },
        update: {
          text: msg.text ?? '',
          isRead: msg.is_read ?? false,
        },
        create: {
          unipileMessageId: msg.id,
          conversationId: conversation.id,
          direction,
          text: msg.text ?? '',
          isRead: msg.is_read ?? false,
          sentAt: new Date(msg.created_at),
          deliveryStatus: 'SENT'
        }
      });
    }

    // Fire and forget: mark read
    unipile.markChatRead(conversation.unipileChatId).catch(console.error);

    return NextResponse.json({
      messages: paginatedMessages.items,
      nextCursor: paginatedMessages.cursor,
      hasMore: paginatedMessages.has_more
    });
  } catch (error: unknown) {
    const isDev = process.env.NODE_ENV === 'development'
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('[Messages GET] Error:', message)
    return NextResponse.json(
      { error: isDev ? message : 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: error instanceof Error && 'status' in error ? (error as any).status || 500 : 500 }
    )
  }
}
