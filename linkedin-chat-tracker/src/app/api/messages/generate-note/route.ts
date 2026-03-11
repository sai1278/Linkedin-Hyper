import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { z } from 'zod'

const generateSchema = z.object({
  recipientName: z.string(),
  recipientHeadline: z.string().optional(),
  recipientCompany: z.string().optional(),
  senderName: z.string(),
  topic: z.string().optional(),
  type: z.enum(['message', 'connection'])
})

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY
    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: 'AI generation not configured' }, { status: 503 })
    }

    const body = await req.json()
    const parsed = generateSchema.parse(body)

    const promptText = `Write a natural, non-salesy LinkedIn ${parsed.type} from ${parsed.senderName} to ${parsed.recipientName}
      ${parsed.recipientHeadline ? `(${parsed.recipientHeadline}` : ''}${parsed.recipientCompany ? ` at ${parsed.recipientCompany})` : ''}.
      ${parsed.topic ? `Context: ${parsed.topic}.` : ''}
      ${parsed.type === 'connection' ? 'Max 300 characters.' : 'Max 500 characters.'}
      Write ONLY the message text. No quotes, no preamble, no sign-off. Sound human and specific.`

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: promptText }]
        }]
      })
    })

    if (!res.ok) {
      const errorData = await res.text()
      console.error('Gemini API Error:', errorData)
      throw new Error('Failed to generate content from AI')
    }

    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

    if (!text) {
      throw new Error('Empty response from AI')
    }

    // Strip quotes if AI accidentally included them
    const cleanText = text.replace(/^["']|["']$/g, '').trim()

    return NextResponse.json({ text: cleanText })

  } catch (error: any) {
    console.error('AI Gen error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
