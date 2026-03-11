import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual, createHmac } from 'crypto';
import { prisma } from '@/lib/prisma';

interface WebhookEvent {
  type: string
  account_id: string
  data: Record<string, unknown>
}

interface NewMessageData {
  id: string
  chat_id: string
  text?: string
  sender_id?: string
  account_id?: string
  created_at: string
  is_read?: boolean
}

interface ConnectionEventData {
  provider_id?: string
  name?: string
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signatureHeader = req.headers.get('x-unipile-signature');

    if (!signatureHeader) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }

    const secret = process.env.UNIPILE_WEBHOOK_SECRET;
    if (!secret) {
      console.error('Webhook secret not configured');
      return NextResponse.json({ error: 'Configuration Error' }, { status: 500 });
    }

    const computedSignature = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    let isSignatureValid = false;
    try {
      if (computedSignature.length === signatureHeader.length) {
        isSignatureValid = timingSafeEqual(
          Buffer.from(computedSignature),
          Buffer.from(signatureHeader)
        );
      }
    } catch (e) {
      console.error('Signature verification failed', e);
    }

    if (!isSignatureValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const event = JSON.parse(rawBody) as WebhookEvent;

    // Fire and forget
    processWebhookEvent(event).catch(err => {
      console.error('Failed to process webhook event:', err);
    });

    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    const isDev = process.env.NODE_ENV === 'development'
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('[Webhook] Error:', message);
    return NextResponse.json(
      { error: isDev ? message : 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: error instanceof Error && 'status' in error ? (error as any).status || 500 : 500 }
    )
  }
}

async function processWebhookEvent(event: WebhookEvent) {
  const { type, account_id, data } = event;

  const account = await prisma.linkedInAccount.findUnique({
    where: { unipileAccountId: account_id }
  });

  if (!account) return;

  switch (type) {
    case 'new_message':
      await handleNewMessage(account.id, data as unknown as NewMessageData);
      break;
    case 'connection_accepted': {
      const connData = data as unknown as ConnectionEventData;
      await prisma.activityLog.create({
        data: {
          accountId: account.id,
          action: 'CONNECTION_ACCEPTED',
          metadata: { provider_id: connData.provider_id, name: connData.name }
        }
      });
      break;
    }
    case 'connection_requested': {
      const reqData = data as unknown as ConnectionEventData;
      await prisma.activityLog.create({
        data: {
          accountId: account.id,
          action: 'CONNECTION_RECEIVED',
          metadata: { provider_id: reqData.provider_id, name: reqData.name }
        }
      });
      break;
    }
  }
}

async function handleNewMessage(accountId: string, data: NewMessageData) {
  const isOutbound = Boolean(data.sender_id) && data.sender_id === data.account_id;
  const direction = isOutbound ? 'OUTBOUND' : 'INBOUND';

  let conversation = await prisma.conversation.findUnique({
    where: { unipileChatId: data.chat_id }
  });

  if (!conversation) {
    // Basic fallback if chat isn't known yet
    conversation = await prisma.conversation.create({
      data: {
        accountId,
        unipileChatId: data.chat_id,
        unreadCount: isOutbound ? 0 : 1,
        lastMessageAt: new Date(data.created_at),
        lastMessageText: data.text,
      }
    });
  } else {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        unreadCount: isOutbound ? conversation.unreadCount : conversation.unreadCount + 1,
        lastMessageAt: new Date(data.created_at),
        lastMessageText: data.text,
      }
    });
  }

  // In handleNewMessage, the upsert is already idempotent thanks to unipileMessageId unique constraint.
  // Add a note for clarity:
  console.log(`[Webhook] Processing message ${data.id} for chat ${data.chat_id}`)

  await prisma.message.upsert({
    where: { unipileMessageId: data.id },
    create: {
      unipileMessageId: data.id,
      conversationId: conversation.id,
      direction,
      text: data.text || '',
      isRead: isOutbound,
      sentAt: new Date(data.created_at),
      deliveryStatus: 'SENT',
    },
    update: {
      text: data.text || '',
    }
  });
}
