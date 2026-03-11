import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getUnipileClient } from '@/lib/unipile'
import { createJob, getJob } from '@/lib/jobStore'
import { z } from 'zod'

const bulkSchema = z.object({
  accountId: z.string(),
  recipients: z.array(z.object({
    profileUrl: z.string(),
    name: z.string().optional(),
    headline: z.string().optional(),
    company: z.string().optional(),
    topic: z.string().optional()
  })).min(1).max(100),
  message: z.string().min(1),
  useAI: z.boolean().default(false)
})

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const parsed = bulkSchema.parse(body)

    // Verify account exists and belongs to user
    const account = await prisma.linkedInAccount.findFirst({
      where: { id: parsed.accountId, userId: session.user.id }
    })

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const jobId = `job-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    
    // Init job state using the store manager
    createJob(jobId, parsed.recipients.length)

    // Start background processing immediately (don't await)
    processBulkJob(jobId, account, parsed, session.user)

    return NextResponse.json({ jobId, total: parsed.recipients.length, status: 'running' }, { status: 202 })

  } catch (error: unknown) {
    const isDev = process.env.NODE_ENV === 'development'
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('[Bulk POST] Error:', message)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    return NextResponse.json(
      { error: isDev ? message : 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: error instanceof Error && 'status' in error ? (error as any).status || 500 : 500 }
    )
  }
}

async function processBulkJob(
  jobId: string,
  account: { id: string; unipileAccountId: string; displayName: string },
  data: z.infer<typeof bulkSchema>,
  user: { name?: string | null }
) {
  const job = getJob(jobId)!
  const unipileClient = getUnipileClient()

  for (const recipient of data.recipients) {
    try {
      let finalMessage = data.message

      if (data.useAI) {
        // Call Gemini directly — no auth needed, it's server-to-server
        const geminiKey = process.env.GEMINI_API_KEY
        if (!geminiKey) throw new Error('GEMINI_API_KEY not configured')

        const promptText = `Write a natural, non-salesy LinkedIn message from ${user.name || account.displayName} to ${recipient.name || 'a connection'}.
${recipient.headline ? `Their headline: ${recipient.headline}.` : ''}
${recipient.company ? `Their company: ${recipient.company}.` : ''}
${recipient.topic ? `Context: ${recipient.topic}.` : ''}
Max 500 characters. Write ONLY the message text. No quotes, no preamble, sound human.`

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] }),
          }
        )

        if (!geminiRes.ok) throw new Error(`Gemini API error: ${geminiRes.status}`)
        const geminiData = await geminiRes.json()
        finalMessage = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
                      ?.replace(/^["']|["']$/g, '') ?? data.message

      } else {
        // Variable interpolation
        finalMessage = finalMessage
          .replace(/{name}/g, recipient.name || '')
          .replace(/{company}/g, recipient.company || '')
      }

      // Send via Unipile API directly
      const sendRes = await fetch(`${unipileClient.publicDsn}/api/v1/chats`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-API-KEY': unipileClient.publicToken,
        },
        body: JSON.stringify({
          account_id: account.unipileAccountId,
          attendees_ids: [recipient.profileUrl],
          text: finalMessage,
        }),
        signal: AbortSignal.timeout(15000),
      })

      if (!sendRes.ok) {
        const errText = await sendRes.text()
        throw new Error(`Unipile API ${sendRes.status}: ${errText.slice(0, 200)}`)
      }

      // Log success
      await prisma.activityLog.create({
        data: {
          accountId: account.id,
          action: 'MESSAGE_SENT',
          metadata: { profileUrl: recipient.profileUrl, source: 'bulk_campaign', jobId },
        },
      })

      job.sent++

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[BulkJob ${jobId}] Failed for ${recipient.profileUrl}:`, message)
      job.failed++
      job.errors.push({ profileUrl: String(recipient.profileUrl), error: message })
    }

    // Rate limit: 3–5 second delay between sends
    const delay = Math.floor(Math.random() * 2000) + 3000
    await new Promise(r => setTimeout(r, delay))
  }

  job.status = 'complete'
  job.completedAt = new Date().toISOString()
}
