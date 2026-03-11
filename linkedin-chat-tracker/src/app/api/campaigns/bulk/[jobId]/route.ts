import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { activeJobs } from './route'

export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const job = activeJobs.get(params.jobId)

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    return NextResponse.json(job)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
