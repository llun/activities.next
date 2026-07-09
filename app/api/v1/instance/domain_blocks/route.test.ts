import { NextRequest } from 'next/server'

import { domainDigest } from '@/lib/services/federation/domainRules'

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
      },
      {
        id: '2',
        type: 'block',
        domain: 'silenced.test',
        severity: 'silence',
        rejectMedia: false,
        rejectReports: false,
        privateComment: null,
        publicComment: 'limited',
        obfuscate: true,
        source: null,
        createdAt: 0,
        updatedAt: 0
      }
    ])
    const getDomainFederationRuleStats = vi.fn().mockResolvedValue({
      blocks: 42,
      suspendBlocks: 7,
      silenceBlocks: 3,
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
      severities: ['silence', 'suspend']
    })
    expect(getDomainFederationRuleStats).toHaveBeenCalledTimes(1)
    expect(response.headers.get('X-Total-Count')).toBe('10')
    expect(response.headers.get('X-Offset')).toBe('5')
    expect(response.headers.get('X-Limit')).toBe('25')
    expect(data).toEqual([
      {
        domain: 'blocked.test',
        digest: domainDigest('blocked.test'),
        severity: 'suspend',
        comment: 'spam'
      },
      {
        // Mastodon quarter-visible obfuscation, not the raw digest.
        domain: 'sile****.*est',
        digest: domainDigest('silenced.test'),
        severity: 'silence',
        comment: 'limited'
      }
    ])
  })

  it('clamps an out-of-range limit instead of rejecting it', async () => {
    const getDomainBlocks = vi.fn().mockResolvedValue([])
    mockGetDatabase.mockReturnValue({
      getDomainBlocks,
      getDomainFederationRuleStats: vi.fn().mockResolvedValue({
        blocks: 0,
        suspendBlocks: 0,
        silenceBlocks: 0,
        allows: 0
      })
    })

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/instance/domain_blocks?limit=1001'
      ),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(getDomainBlocks).toHaveBeenCalledWith({
      limit: 1000,
      offset: 0,
      severities: ['silence', 'suspend']
    })
  })
})
