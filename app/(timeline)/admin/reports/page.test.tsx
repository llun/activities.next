/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import Page from './page'

const getAdminReports = vi.fn()
const mockDatabase = { getAdminReports }

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

const mockDomains = vi.fn()
vi.mock('@/lib/services/domains/adminDomains', () => ({
  getAdminDomainList: (...args: unknown[]) => mockDomains(...args)
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`Unexpected redirect to ${path}`)
  })
}))

vi.mock('./AdminReportsList', () => ({
  AdminReportsList: () => null
}))

type Element = { props: Record<string, unknown> }

const load = async (domain?: string | string[]) => {
  const tree = (await Page({
    searchParams: Promise.resolve({ domain })
  })) as unknown as { props: { children: Element[] } }
  const [header, list] = tree.props.children
  return {
    header: header.props as { title: string; description: string },
    list: list.props as { servedDomains: string[]; domain: string | null }
  }
}

describe('/admin/reports loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDomains.mockResolvedValue({
      domains: [{ domain: 'social.example' }, { domain: 'run.example' }]
    })
    getAdminReports.mockResolvedValue([{}, {}])
  })

  it('passes a served domain choice and counts its open reports', async () => {
    const { header, list } = await load('run.example')
    expect(list.domain).toBe('run.example')
    expect(list.servedDomains).toEqual(['social.example', 'run.example'])
    expect(header.title).toBe('Reports on run.example')
    expect(header.description).toContain('2 open reports')
    expect(getAdminReports).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'run.example', resolved: false })
    )
  })

  it('takes the first value of a repeated parameter', async () => {
    const { list } = await load(['run.example', 'social.example'])
    expect(list.domain).toBe('run.example')
  })

  it('ignores a domain that is not served', async () => {
    const { header, list } = await load('other.example')
    expect(list.domain).toBeNull()
    expect(header.title).toBe('Reports')
    expect(getAdminReports).not.toHaveBeenCalled()
  })

  it('ignores the choice while only one domain is served', async () => {
    mockDomains.mockResolvedValue({ domains: [{ domain: 'run.example' }] })
    const { list } = await load('run.example')
    expect(list.domain).toBeNull()
  })

  it('marks a full page of open reports as capped', async () => {
    getAdminReports.mockResolvedValue(new Array(1000).fill({}))
    const { header } = await load('run.example')
    expect(header.description).toContain('1000+ open reports')
  })
})
