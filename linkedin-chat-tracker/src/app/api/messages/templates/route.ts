import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'

const templateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['MESSAGE', 'CONNECTION_NOTE']),
  body: z.string().max(8000, 'Body too long'),
  variables: z.array(z.string()).default([])
})

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const typeFilter = req.nextUrl.searchParams.get('type')
    
    const where: Prisma.MessageTemplateWhereInput = { userId: session.user.id }
    if (typeFilter && (typeFilter === 'MESSAGE' || typeFilter === 'CONNECTION_NOTE')) {
      where.type = typeFilter
    }

    const templates = await prisma.messageTemplate.findMany({
      where,
      orderBy: { usageCount: 'desc' },
    })

    return NextResponse.json(templates)
  } catch (error: unknown) {
    const isDev = process.env.NODE_ENV === 'development'
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('[Templates GET] Error:', message)
    return NextResponse.json(
      { error: isDev ? message : 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: error instanceof Error && 'status' in error ? (error as any).status || 500 : 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const parsed = templateSchema.parse(body)

    const template = await prisma.messageTemplate.create({
      data: {
        userId: session.user.id,
        name: parsed.name,
        type: parsed.type,
        body: parsed.body,
        variables: parsed.variables,
      }
    })

    return NextResponse.json(template, { status: 201 })
  } catch (error: unknown) {
    const isDev = process.env.NODE_ENV === 'development'
    const message = error instanceof Error ? error.message : 'Internal server error'
    console.error('[Templates POST] Error:', message)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    return NextResponse.json(
      { error: isDev ? message : 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: error instanceof Error && 'status' in error ? (error as any).status || 500 : 500 }
    )
  }
}
