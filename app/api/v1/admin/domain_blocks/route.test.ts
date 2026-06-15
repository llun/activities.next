import { NextRequest } from 'next/server'

import { GET, POST } from './route'

const mockDatabase = {
  getDomainBlocks: vi.fn(),
  getDomainFederationRuleStats: vi.fn(),
  createDomainBlock: vi.fn()
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

describe('/api/v1/admin/domain_blocks', () => {
  beforeEach(() => {
    mockDatabase.getDomainBlocks.mockReset()
    mockDatabase.getDomainFederationRuleStats.mockReset()
    mockDatabase.createDomainBlock.mockReset()
  })

  it('lists admin domain blocks', async () => {
    mockDatabase.getDomainBlocks.mockResolvedValue([
      {
        id: 'block-1',
        type: 'block',
        domain: 'blocked.test',
        severity: 'suspend',
        rejectMedia: true,
        rejectReports: false,
        privateComment: null,
        publicComment: 'spam',
        obfuscate: false,
        source: null,
        createdAt: 0,
        updatedAt: 0
      }
    ])
    mockDatabase.getDomainFederationRuleStats.mockResolvedValue({
      blocks: 42,
      allows: 0,
      sourceBlocks: 0,
      sourceCounts: {}
    })

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/admin/domain_blocks?limit=25&offset=5'
      ),
      { params: Promise.resolve({}) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-total-count')).toBe('42')
    expect(response.headers.get('x-offset')).toBe('5')
    expect(response.headers.get('x-limit')).toBe('25')
    expect(mockDatabase.getDomainBlocks).toHaveBeenCalledWith({
      limit: 25,
      offset: 5
    })
    expect(data[0]).toMatchObject({
      id: 'block-1',
      domain: 'blocked.test',
      severity: 'suspend',
      reject_media: true,
      public_comment: 'spam'
    })
  })

  it('creates domain blocks from JSON bodies', async () => {
    mockDatabase.createDomainBlock.mockResolvedValue({
      id: 'block-2',
      type: 'block',
      domain: 'new.test',
      severity: 'silence',
      rejectMedia: false,
      rejectReports: true,
      privateComment: null,
      publicComment: null,
      obfuscate: false,
      source: null,
      createdAt: 0,
      updatedAt: 0
    })

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Origin: 'https://llun.test'
        },
        body: JSON.stringify({
          domain: 'new.test',
          severity: 'silence',
          reject_reports: true
        })
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.createDomainBlock).toHaveBeenCalledWith({
      domain: 'new.test',
      severity: 'silence',
      rejectMedia: false,
      rejectReports: true,
      privateComment: null,
      publicComment: null,
      obfuscate: false,
      source: null
    })
  })

  it('creates domain blocks from checkbox-style values', async () => {
    mockDatabase.createDomainBlock.mockResolvedValue({
      id: 'block-3',
      type: 'block',
      domain: 'form.test',
      severity: 'suspend',
      rejectMedia: true,
      rejectReports: false,
      privateComment: null,
      publicComment: null,
      obfuscate: true,
      source: null,
      createdAt: 0,
      updatedAt: 0
    })

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Origin: 'https://llun.test'
        },
        body: JSON.stringify({
          domain: 'form.test',
          reject_media: 'on',
          obfuscate: 'on'
        })
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.createDomainBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'form.test',
        rejectMedia: true,
        obfuscate: true
      })
    )
  })

  it('rejects invalid JSON bodies', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks', {
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
    expect(mockDatabase.createDomainBlock).not.toHaveBeenCalled()
  })
})
