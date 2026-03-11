import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { z } from 'zod'

const templateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['MESSAGE', 'CONNECTION_NOTE']).optional(),
  body: z.string().max(8000).optional(),
  variables: z.array(z.string()).optional(),
  usageCount: z.number().optional()
})

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const template = await prisma.messageTemplate.findUnique({ where: { id: params.id } })
    if (!template || template.userId !== session.user.id) {
      return NextResponse.json({ error: 'Not found or unauthorized' }, { status: 404 })
    }

    const body = await req.json()
    const parsed = templateSchema.parse(body)

    const updated = await prisma.messageTemplate.update({
      where: { id: params.id },
      data: parsed
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const template = await prisma.messageTemplate.findUnique({ where: { id: params.id } })
    if (!template || template.userId !== session.user.id) {
      return NextResponse.json({ error: 'Not found or unauthorized' }, { status: 404 })
    }

    await prisma.messageTemplate.delete({ where: { id: params.id } })

    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
