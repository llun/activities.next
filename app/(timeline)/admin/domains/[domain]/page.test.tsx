/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { notFound, redirect } from 'next/navigation'

import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

import Page from './page'

const getOwnInstanceRules = vi.fn()
const getAnnouncements = vi.fn()
const getAdminReports = vi.fn()
const mockDatabase = { getOwnInstanceRules, getAnnouncements, getAdminReports }

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn(() => mockDatabase)
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'admin@llun.test' }
  })
}))

vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: vi.fn().mockResolvedValue({ id: 'admin' })
}))

const mockGetAdminDomain = vi.fn()
vi.mock('@/lib/services/domains/adminDomains', () => ({
  getAdminDomain: (...args: unknown[]) => mockGetAdminDomain(...args),
  getEnvDomains: () => ({ primary: 'social.example', trusted: [] }),
  getServerIdentityView: vi.fn().mockResolvedValue({ name: 'Server' })
}))

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn().mockResolvedValue({ features: {} })
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`Unexpected redirect to ${path}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  })
}))

vi.mock('@/lib/components/admin/domains/DomainSettings', () => ({
  DomainSettings: () => null
}))

type Scope = {
  announcements: { id: string }[]
  allDomainsAnnouncements: number
  openReports: number
  openReportsCapped: boolean
  ownRules: unknown[]
}

const load = async (domain = 'run.example') => {
  const tree = (await Page({
    params: Promise.resolve({ domain })
  })) as unknown as { props: { scope: Scope } }
  return tree.props.scope
}

const now = Date.now()
const hour = 3_600_000
const announcement = (
  id: string,
  published: boolean,
  startsAt: number | null,
  endsAt: number | null
) => ({
  id,
  domain: null,
  text: id,
  published,
  allDay: false,
  startsAt,
  endsAt,
  publishedAt: null,
  createdAt: 0,
  updatedAt: 0
})

describe('/admin/domains/[domain] loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAdminDomain.mockResolvedValue({
      domain: 'run.example',
      source: 'env'
    })
    getOwnInstanceRules.mockResolvedValue([])
    getAnnouncements.mockResolvedValue([])
    getAdminReports.mockResolvedValue([])
  })

  it('keeps own announcements that are published or scheduled only', async () => {
    getAnnouncements.mockImplementation(
      async ({ domain }: { domain: string | null }) =>
        domain === 'run.example'
          ? [
              announcement('live', true, null, null),
              announcement('soon', true, now + hour, null),
              announcement('draft', false, null, null),
              announcement('old', true, null, now - hour)
            ]
          : []
    )
    const scope = await load()
    expect(scope.announcements.map((item) => item.id)).toEqual(['live', 'soon'])
  })

  it('counts only all-domains announcements that show now', async () => {
    getAnnouncements.mockImplementation(
      async ({ domain }: { domain: string | null }) =>
        domain === null
          ? [
              announcement('live', true, null, null),
              announcement('started', true, now - hour, now + hour),
              announcement('soon', true, now + hour, null),
              announcement('draft', false, null, null),
              announcement('old', true, null, now - hour)
            ]
          : []
    )
    expect((await load()).allDomainsAnnouncements).toBe(2)
  })

  it('does not query rules of its own for the primary domain', async () => {
    mockGetAdminDomain.mockResolvedValue({
      domain: 'social.example',
      source: 'primary'
    })
    const scope = await load('social.example')
    expect(scope.ownRules).toEqual([])
    expect(getOwnInstanceRules).toHaveBeenCalledTimes(1)
    expect(getOwnInstanceRules).toHaveBeenCalledWith({ domain: null })
  })

  it('queries own rules for a non-primary domain', async () => {
    await load()
    expect(getOwnInstanceRules).toHaveBeenCalledWith({ domain: 'run.example' })
  })

  it('shows exactly 1000 open reports as is', async () => {
    getAdminReports.mockResolvedValue(new Array(1000).fill({}))
    const scope = await load()
    expect(scope.openReports).toBe(1000)
    expect(scope.openReportsCapped).toBe(false)
    expect(getAdminReports).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'run.example',
        resolved: false,
        limit: 1001
      })
    )
  })

  it('marks 1001 open reports as capped', async () => {
    getAdminReports.mockResolvedValue(new Array(1001).fill({}))
    const scope = await load()
    expect(scope.openReports).toBe(1000)
    expect(scope.openReportsCapped).toBe(true)
  })

  it('redirects a non-admin to the home page', async () => {
    vi.mocked(getAdminFromSession).mockResolvedValueOnce(null as never)
    vi.mocked(redirect).mockImplementationOnce((() => {
      throw new Error('NEXT_REDIRECT')
    }) as never)
    await expect(load()).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/')
    expect(getAnnouncements).not.toHaveBeenCalled()
  })

  it('returns not found for an unknown domain', async () => {
    mockGetAdminDomain.mockResolvedValue(null)
    await expect(load('nope.example')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })
})
