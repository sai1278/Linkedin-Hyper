import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'

export async function GET(
  req: NextRequest,
  { params }: { params: { accountId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
    }

    const accountId = params.accountId
    const period = req.nextUrl.searchParams.get('period') || '30d'
    
    // Verify account ownership
    const account = await prisma.linkedInAccount.findFirst({
      where: { id: accountId, userId: session.user.id }
    })

    if (!account) {
      return NextResponse.json({ error: 'Account not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    let days = 30
    if (period === '7d') days = 7
    if (period === '90d') days = 90
    if (period === 'all') days = 365 * 10 

    const periodStart = new Date(Date.now() - days * 86400 * 1000)

    // 1. Core stats
    const totalMessagesSent = await prisma.message.count({
      where: {
        direction: 'OUTBOUND',
        sentAt: { gte: periodStart },
        conversation: { accountId }
      }
    })

    const totalRepliesReceived = await prisma.message.count({
      where: {
        direction: 'INBOUND',
        sentAt: { gte: periodStart },
        conversation: { accountId }
      }
    })

    const totalConnectionsSent = await prisma.activityLog.count({
      where: {
        accountId,
        action: 'CONNECTION_SENT',
        occurredAt: { gte: periodStart }
      }
    })

    const connectionsAccepted = await prisma.activityLog.count({
      where: {
        accountId,
        action: 'CONNECTION_ACCEPTED',
        occurredAt: { gte: periodStart }
      }
    })

    const responseRate = totalMessagesSent > 0 ? (totalRepliesReceived / totalMessagesSent) * 100 : 0
    const acceptanceRate = totalConnectionsSent > 0 ? (connectionsAccepted / totalConnectionsSent) * 100 : 0

    // 2. Daily Series
    // Instead of raw query, doing JS aggregation due to varying DB engines (sqlite vs postgres dates). 
    // This is safer for universal deployment.
    const allOutboundMsgs = await prisma.message.findMany({
      where: { direction: 'OUTBOUND', sentAt: { gte: periodStart }, conversation: { accountId } },
      select: { sentAt: true }
    })
    
    const allInboundMsgs = await prisma.message.findMany({
      where: { direction: 'INBOUND', sentAt: { gte: periodStart }, conversation: { accountId } },
      select: { sentAt: true }
    })
    
    const allConnectionsSent = await prisma.activityLog.findMany({
      where: { action: 'CONNECTION_SENT', occurredAt: { gte: periodStart }, accountId },
      select: { occurredAt: true }
    })

    const dailyMap = new Map<string, any>()
    
    // Helper to format YYYY-MM-DD
    const formatDate = (date: Date) => date.toISOString().split('T')[0]

    // Pre-fill days to avoid gaps
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = formatDate(d)
      dailyMap.set(dateStr, { date: dateStr, messagesSent: 0, connectionsSent: 0, replies: 0 })
    }

    allOutboundMsgs.forEach(m => {
      const d = formatDate(m.sentAt)
      if (dailyMap.has(d)) dailyMap.get(d).messagesSent++
    })

    allInboundMsgs.forEach(m => {
      const d = formatDate(m.sentAt)
      if (dailyMap.has(d)) dailyMap.get(d).replies++
    })

    allConnectionsSent.forEach(a => {
      const d = formatDate(a.occurredAt)
      if (dailyMap.has(d)) dailyMap.get(d).connectionsSent++
    })

    const dailySeries = Array.from(dailyMap.values())

    // 3. Top Contacts
    // Group by conversation
    const conversations = await prisma.conversation.findMany({
      where: { accountId },
      include: { contact: true, messages: { select: { direction: true } } }
    })

    const processedContacts = conversations.map(conv => {
      return {
        contactId: conv.contact.id,
        name: conv.contact.name,
        avatarUrl: conv.contact.avatarUrl,
        messageCount: conv.messages.length,
        replied: conv.messages.some(m => m.direction === 'INBOUND')
      }
    })

    const topContacts = processedContacts
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, 10)

    // 4. Activity Log
    const activityLog = await prisma.activityLog.findMany({
      where: { accountId, occurredAt: { gte: periodStart } },
      orderBy: { occurredAt: 'desc' },
      take: 50
    })

    return NextResponse.json({
      stats: {
        totalMessagesSent,
        totalConnectionsSent,
        totalRepliesReceived,
        connectionsAccepted,
        responseRate,
        acceptanceRate
      },
      dailySeries,
      topContacts,
      activityLog
    })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
