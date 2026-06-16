import { NextRequest } from 'next/server'

import { GET } from './route'

const mockGetDatabase = vi.fn()
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockGetDatabase()
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ host: 'llun.test', allowEmails: [] })
}))

describe('GET /api/v1/instance/domain_blocks', () => {
  beforeEach(() => {
    mockGetDatabase.mockReset()
  })

  it('returns paginated public Mastodon-shaped domain blocks', async () => {
    const getDomainBlocks = vi.fn().mockResolvedValue([
      {
        id: '1',
        type: 'block',
        domain: 'blocked.test',
        severity: 'suspend',
        rejectMedia: false,
        rejectReports: false,
        privateComment: 'internal',
        publicComment: 'spam',
        obfuscate: false,
        source: null,
        createdAt: 0,
        updatedAt: 0
      }
    ])
    const getDomainFederationRuleStats = vi.fn().mockResolvedValue({
      blocks: 42,
      suspendBlocks: 7,
      allows: 0
    })

    mockGetDatabase.mockReturnValue({
      getDomainBlocks,
      getDomainFederationRuleStats
    })

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/instance/domain_blocks?limit=25&offset=5'
      ),
      { params: Promise.resolve({}) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(getDomainBlocks).toHaveBeenCalledWith({
      limit: 25,
      offset: 5,
      severity: 'suspend'
    })
    expect(getDomainFederationRuleStats).toHaveBeenCalledTimes(1)
    expect(response.headers.get('X-Total-Count')).toBe('7')
    expect(response.headers.get('X-Offset')).toBe('5')
    expect(response.headers.get('X-Limit')).toBe('25')
    expect(data).toEqual([
      {
        domain: 'blocked.test',
        digest:
          'cc5ac927c0bbef58bde4777f9afc52f3ed6c8d0652af02e650d33035030398f2',
        severity: 'suspend',
        comment: 'spam'
      }
    ])
  })

  it('rejects invalid pagination parameters', async () => {
    const getDomainBlocks = vi.fn()
    mockGetDatabase.mockReturnValue({
      getDomainBlocks,
      getDomainFederationRuleStats: vi.fn()
    })

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/instance/domain_blocks?limit=1001'
      ),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(getDomainBlocks).not.toHaveBeenCalled()
  })
})
