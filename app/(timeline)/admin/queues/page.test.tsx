/**
 * @vitest-environment jsdom
 */
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
  }),
  useRouter: () => ({ refresh: vi.fn() })
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

    expect(markup).toContain('Queues &amp; dead letter queue')
    expect(markup).toContain('processActivity')
    expect(markup).toContain('Connection timed out')
    expect(markup).toContain('failed')
    expect(markup).toContain('Attempts')
    expect(markup).toContain('Retry all failed')
    expect(markup).toContain('Drop all messages')
    expect(markup).toContain('Cloud Tasks (Database DLQ)')
  })

  it('offers the statuses as links with their counts, marking the current one', async () => {
    mockDLQProvider.getJobs.mockResolvedValue({
      jobs: mockJobs,
      total: 1,
      counts: { all: 6, failed: 3, retried: 2, discarded: 1 }
    })
    const markup = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({ status: 'retried' }) })
    )
    const container = document.createElement('div')
    container.innerHTML = markup

    const nav = container.querySelector('nav[aria-label="Job status"]')
    const links = Array.from(nav?.querySelectorAll('a') ?? [])
    expect(links.map((link) => link.textContent)).toEqual([
      'All6',
      'Failed3',
      'Retried2',
      'Discarded1'
    ])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/admin/queues',
      '/admin/queues?status=failed',
      '/admin/queues?status=retried',
      '/admin/queues?status=discarded'
    ])
    expect(
      links.filter((link) => link.getAttribute('aria-current') === 'page')
    ).toHaveLength(1)
    expect(links[2].getAttribute('aria-current')).toBe('page')
  })

  it('only offers All and Failed on the QStash backend', async () => {
    mockDLQProvider.type = 'qstash'
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({}) })
    )

    expect(
      Array.from(
        container.querySelectorAll('nav[aria-label="Job status"] a')
      ).map((link) => link.textContent?.replace(/\d+$/, ''))
    ).toEqual(['All', 'Failed'])
  })

  it('pages under the table with the status kept in the links', async () => {
    mockDLQProvider.getJobs.mockResolvedValue({
      jobs: mockJobs,
      total: 45,
      counts: { all: 45, failed: 45, retried: 0, discarded: 0 }
    })
    const markup = renderToStaticMarkup(
      await Page({
        searchParams: Promise.resolve({ status: 'failed', page: '2' })
      })
    )

    expect(markup).toContain('Page 2 of 3 (45 total jobs)')
    expect(markup).toContain('href="/admin/queues?status=failed"')
    expect(markup).toContain('href="/admin/queues?status=failed&amp;page=3"')
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
