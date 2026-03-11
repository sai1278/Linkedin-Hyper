export interface JobProgress {
  status: 'running' | 'complete' | 'failed'
  total: number
  sent: number
  failed: number
  errors: Array<{ profileUrl: string; error: string }>
  startedAt: string
  completedAt?: string
}

// In-memory store. NOTE: In production use Redis for multi-instance deployments.
// Jobs are lost on server restart — acceptable for Phase 7 background tasks.
export const activeJobs = new Map<string, JobProgress>()

export function createJob(jobId: string, total: number): JobProgress {
  const job: JobProgress = {
    status: 'running',
    total,
    sent: 0,
    failed: 0,
    errors: [],
    startedAt: new Date().toISOString(),
  }
  activeJobs.set(jobId, job)
  return job
}

export function getJob(jobId: string): JobProgress | undefined {
  return activeJobs.get(jobId)
}
