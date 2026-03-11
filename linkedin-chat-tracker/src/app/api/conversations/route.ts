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

    const searchParams = req.nextUrl.searchParams;
    const accountId = searchParams.get('accountId');
    const cursor = searchParams.get('cursor') || undefined;
    const search = searchParams.get('search');
    const filter = searchParams.get('filter');

    if (!accountId) {
      return NextResponse.json({ error: 'accountId is required', code: 'BAD_REQUEST' }, { status: 400 });
    }

    const account = await prisma.linkedInAccount.findFirst({
      where: { id: accountId, userId: session.user.id }
    });

    if (!account) {
      return NextResponse.json({ error: 'Account not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const paginatedChats = await unipile.listChats(account.unipileAccountId, cursor);

    // Upsert Contacts & Conversations
    for (const chat of paginatedChats.items) {
      for (const participant of chat.participants) {
        await prisma.contact.upsert({
          where: { unipileId: participant.id },
          update: {
            name: participant.name,
            headline: participant.headline,
            avatarUrl: participant.avatar_url,
            profileUrl: participant.profile_url,
          },
          create: {
            unipileId: participant.id,
            accountId: account.id,
            name: participant.name,
            headline: participant.headline,
            avatarUrl: participant.avatar_url,
            profileUrl: participant.profile_url,
          }
        });
      }

      await prisma.conversation.upsert({
        where: { unipileChatId: chat.id },
        update: {
          unreadCount: chat.unread_count,
          lastMessageAt: chat.last_message?.created_at ? new Date(chat.last_message.created_at) : undefined,
          lastMessageText: chat.last_message?.text,
        },
        create: {
          unipileChatId: chat.id,
          accountId: account.id,
          unreadCount: chat.unread_count,
          lastMessageAt: chat.last_message?.created_at ? new Date(chat.last_message.created_at) : new Date(),
          lastMessageText: chat.last_message?.text,
        }
      });
    }

    // Process search & filter constraints on fetched dataset
    let displayChats = paginatedChats.items;

    if (filter === 'unread') {
      displayChats = displayChats.filter(c => c.unread_count > 0);
    }
    
    if (search) {
      const s = search.toLowerCase();
      displayChats = displayChats.filter(c => 
        c.last_message?.text?.toLowerCase().includes(s) || 
        c.participants.some(p => p.name.toLowerCase().includes(s))
      );
    }

    return NextResponse.json({
      conversations: displayChats,
      nextCursor: paginatedChats.cursor,
      hasMore: paginatedChats.has_more
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to list conversations', code: error.code || 'INTERNAL_ERROR' },
      { status: error.status || 500 }
    );
  }
}
