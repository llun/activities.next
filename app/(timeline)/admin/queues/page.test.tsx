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

const mockDLQProvider = {
  type: 'database' as 'database' | 'qstash',
  getJobs: vi.fn(),
  retryJob: vi.fn(),
  discardJob: vi.fn(),
  retryAll: vi.fn(),
  clearDiscarded: vi.fn(),
  dropAll: vi.fn()
}

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => ({}))
}))

vi.mock('@/lib/services/queue/dlq', () => ({
  getDLQProvider: () => mockDLQProvider
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
    mockDLQProvider.type = 'database'
    mockDLQProvider.getJobs.mockResolvedValue({
      jobs: mockJobs,
      total: 1,
      counts: { all: 1, failed: 1, retried: 0, discarded: 0 }
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
    expect(markup).toContain('Drop all messages')
    expect(markup).toContain('Cloud Tasks (Database DLQ)')
  })

  it('passes status filter to provider query', async () => {
    await Page({ searchParams: Promise.resolve({ status: 'failed' }) })

    expect(mockDLQProvider.getJobs).toHaveBeenCalledWith({
      status: 'failed',
      limit: 20,
      offset: 0
    })
  })

  it('renders QStash backend badge and tabs when qstash provider is active', async () => {
    mockDLQProvider.type = 'qstash'
    const markup = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({}) })
    )
    expect(markup).toContain('Upstash QStash (Native DLQ)')
  })
})
