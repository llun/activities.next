import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Page from './page'

const mockJobs = [
  {
    id: 'job-1',
    jobName: 'processActivity',
    payload: { id: 'm1', name: 'processActivity', data: {} },
    errorMessage: 'Connection timed out',
    errorStack: 'Error: Connection timed out',
    attempts: 5,
    status: 'failed',
    createdAt: new Date('2026-09-03T10:00:00Z').getTime(),
    updatedAt: new Date('2026-09-03T10:00:00Z').getTime()
  }
]

const mockDatabase = {
  getDeadLetterJobs: vi.fn(),
  countDeadLetterJobs: vi.fn()
}

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => mockDatabase)
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'admin@llun.test' }
  })
}))

vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: vi.fn().mockResolvedValue({
    id: 'admin',
    email: 'admin@llun.test'
  })
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  })
}))

describe('/admin/queues page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getDeadLetterJobs.mockResolvedValue(mockJobs)
    mockDatabase.countDeadLetterJobs.mockImplementation(({ status } = {}) => {
      if (!status) return Promise.resolve(1)
      if (status === 'failed') return Promise.resolve(1)
      return Promise.resolve(0)
    })
  })

  it('renders dead letter queue heading, job details, and stats', async () => {
    const markup = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({}) })
    )

    expect(markup).toContain('Queues &amp; Dead Letter Queue')
    expect(markup).toContain('processActivity')
    expect(markup).toContain('Connection timed out')
    expect(markup).toContain('failed')
    expect(markup).toContain('Attempts: 5')
    expect(markup).toContain('Retry all failed')
  })

  it('passes status filter to database query', async () => {
    await Page({ searchParams: Promise.resolve({ status: 'failed' }) })

    expect(mockDatabase.getDeadLetterJobs).toHaveBeenCalledWith({
      status: 'failed',
      limit: 20,
      offset: 0
    })
  })
})
