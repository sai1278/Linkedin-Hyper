import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { unipile } from '@/lib/unipile';
import { auth } from '@/lib/auth';

const sendMessageSchema = z.union([
  z.object({
    chatId: z.string(),
    text: z.string().min(1),
  }),
  z.object({
    accountId: z.string(),
    profileUrl: z.string().url(),
    text: z.string().min(1),
  }),
]);

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const body = await req.json();
    const result = sendMessageSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid payload', code: 'VALIDATION_ERROR', details: result.error.errors },
        { status: 400 }
      );
    }

    const data = result.data;
    let sentMessage;
    let dbConversation;

    if ('chatId' in data) {
      // Send to existing chat
      dbConversation = await prisma.conversation.findFirst({
        where: { 
          id: data.chatId,
          account: { userId: session.user.id }
        },
        include: { account: true }
      });

      if (!dbConversation) {
        return NextResponse.json({ error: 'Conversation not found', code: 'NOT_FOUND' }, { status: 404 });
      }

      sentMessage = await unipile.sendMessage(dbConversation.unipileChatId, data.text);

    } else {
      // Send to new profile
      const account = await prisma.linkedInAccount.findFirst({
        where: { id: data.accountId, userId: session.user.id }
      });

      if (!account) {
        return NextResponse.json({ error: 'Account not found', code: 'NOT_FOUND' }, { status: 404 });
      }

      sentMessage = await unipile.sendMessageToProfile(account.unipileAccountId, data.profileUrl, data.text);
      
      // Upsert conversation to attach the message to
      dbConversation = await prisma.conversation.upsert({
        where: { unipileChatId: sentMessage.chat_id },
        update: {
          lastMessageAt: new Date(sentMessage.created_at),
          lastMessageText: sentMessage.text,
        },
        create: {
          unipileChatId: sentMessage.chat_id,
          accountId: account.id,
          unreadCount: 0,
          lastMessageAt: new Date(sentMessage.created_at),
          lastMessageText: sentMessage.text,
        }
      });
    }

    // Persist message
    const savedMessage = await prisma.message.create({
      data: {
        unipileMessageId: sentMessage.id,
        conversationId: dbConversation.id,
        direction: 'OUTBOUND',
        text: sentMessage.text,
        isRead: true, // Outbound messages are always read by the sender
        sentAt: new Date(sentMessage.created_at),
        deliveryStatus: 'SENT'
      }
    });

    return NextResponse.json(savedMessage);
  } catch (error: unknown) {
    const isDev = process.env.NODE_ENV === 'development'
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('[Messages POST] Error:', message)
    return NextResponse.json(
      { error: isDev ? message : 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: error instanceof Error && 'status' in error ? (error as any).status || 500 : 500 }
    )
  }
}
