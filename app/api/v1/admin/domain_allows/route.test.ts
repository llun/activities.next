import { NextRequest } from 'next/server'

import { GET, POST } from './route'

const mockDatabase = {
  getDomainAllows: vi.fn(),
  getDomainFederationRuleStats: vi.fn(),
  createDomainAllow: vi.fn()
}

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
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

vi.mock('@/lib/config', () => ({
  getBaseURL: () => 'https://llun.test',
  getConfig: () => ({ host: 'llun.test', allowEmails: [] })
}))

describe('/api/v1/admin/domain_allows', () => {
  beforeEach(() => {
    mockDatabase.getDomainAllows.mockReset()
    mockDatabase.getDomainFederationRuleStats.mockReset()
    mockDatabase.createDomainAllow.mockReset()
  })

  it('lists admin domain allows with pagination', async () => {
    mockDatabase.getDomainAllows.mockResolvedValue([
      {
        id: 'allow-1',
        type: 'allow',
        domain: 'trusted.test',
        createdAt: 0,
        updatedAt: 0
      }
    ])
    mockDatabase.getDomainFederationRuleStats.mockResolvedValue({
      blocks: 0,
      allows: 12,
      sourceBlocks: 0,
      sourceCounts: {}
    })

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/admin/domain_allows?limit=10&offset=2'
      ),
      { params: Promise.resolve({}) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-total-count')).toBe('12')
    expect(response.headers.get('x-offset')).toBe('2')
    expect(response.headers.get('x-limit')).toBe('10')
    expect(mockDatabase.getDomainAllows).toHaveBeenCalledWith({
      limit: 10,
      offset: 2
    })
    expect(data[0]).toMatchObject({
      id: 'allow-1',
      domain: 'trusted.test'
    })
  })

  it('rejects invalid JSON bodies', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/admin/domain_allows', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Origin: 'https://llun.test'
        },
        body: '{'
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(mockDatabase.createDomainAllow).not.toHaveBeenCalled()
  })

  it('paginates with max_id and emits Link headers instead of offset headers', async () => {
    mockDatabase.getDomainAllows.mockResolvedValue([
      {
        id: 'allow-2',
        type: 'allow',
        domain: 'b.test',
        createdAt: 0,
        updatedAt: 0
      },
      {
        id: 'allow-3',
        type: 'allow',
        domain: 'c.test',
        createdAt: 0,
        updatedAt: 0
      }
    ])
    mockDatabase.getDomainFederationRuleStats.mockResolvedValue({
      blocks: 0,
      allows: 3,
      sourceBlocks: 0,
      sourceCounts: {}
    })

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/admin/domain_allows?limit=2&max_id=allow-1'
      ),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.getDomainAllows).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 2, maxId: 'allow-1' })
    )
    const link = response.headers.get('link') ?? ''
    expect(link).toContain('max_id=allow-3')
    expect(link).toContain('rel="next"')
    expect(link).toContain('min_id=allow-2')
    expect(link).toContain('rel="prev"')
    expect(response.headers.get('x-total-count')).toBeNull()
  })
})
