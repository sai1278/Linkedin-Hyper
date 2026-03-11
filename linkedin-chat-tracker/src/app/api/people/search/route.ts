import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { UnipileClient } from '@/lib/unipile'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')
    const accountId = searchParams.get('accountId')

    if (!q || q.length < 2) {
      return NextResponse.json({ error: 'Search query must be at least 2 characters' }, { status: 400 })
    }

    if (!accountId) {
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
    }

    // Verify account ownership
    const account = await prisma.linkedInAccount.findFirst({
      where: { id: accountId, userId: session.user.id }
    })

    if (!account) {
      return NextResponse.json({ error: 'Account not found or unauthorized' }, { status: 404 })
    }

    const unipile = new UnipileClient()
    
    // In a real scenario we'd call a Unipile people search endpoint like `GET /users?search={q}&account_id={unipileAccountId}`
    // Since we don't have the exact Unipile SDK method for this in our snippet, we'll manually fetch it:
    const params = new URLSearchParams({
      account_id: account.unipileAccountId,
      search: q,
      limit: '10'
    })

    const res = await fetch(`${unipile.dsn}/users?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-API-KEY': unipile.token
      }
    })

    if (!res.ok) {
      const errorText = await res.text()
      console.error('Unipile search error:', errorText)
      // Throw a friendly error or fallback to mock data for demo purposes?
      // Let's pass the error up
      throw new Error(`Unipile API returned ${res.status}`)
    }

    const data = await res.json()
    // Unipile returns an array of user objects. We'll return it directly.
    return NextResponse.json(data.items || data || [])

  } catch (error: any) {
    console.error('People search failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
