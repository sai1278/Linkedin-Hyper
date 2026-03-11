import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
    }

    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    // Parallelize queries for performance
    const [
      totalConversations,
      messagesSentToday,
      connectionsToday,
      unreadAgg
    ] = await Promise.all([
      prisma.conversation.count({
        where: { account: { userId: session.user.id } }
      }),
      prisma.message.count({
        where: {
          direction: 'OUTBOUND',
          sentAt: { gte: today },
          conversation: { account: { userId: session.user.id } }
        }
      }),
      prisma.activityLog.count({
        where: {
          action: 'CONNECTION_SENT',
          occurredAt: { gte: today },
          account: { userId: session.user.id }
        }
      }),
      prisma.conversation.aggregate({
        where: { account: { userId: session.user.id } },
        _sum: { unreadCount: true }
      })
    ])

    return NextResponse.json({
      totalConversations,
      messagesSentToday,
      connectionsToday,
      unreadMessages: unreadAgg._sum.unreadCount || 0
    })

  } catch (error: unknown) {
    const isDev = process.env.NODE_ENV === 'development'
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('[Analytics Summary GET] Error:', message)
    return NextResponse.json(
      { error: isDev ? message : 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: error instanceof Error && 'status' in error ? (error as any).status || 500 : 500 }
    )
  }
}
