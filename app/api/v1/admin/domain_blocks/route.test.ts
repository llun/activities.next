import { NextRequest } from 'next/server'

import { GET, POST } from './route'

const mockDatabase = {
  getDomainBlocks: jest.fn(),
  createDomainBlock: jest.fn()
}

jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: jest.fn().mockResolvedValue({
    user: { email: 'admin@llun.test' }
  })
}))

jest.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: jest.fn().mockResolvedValue({
    id: 'admin',
    email: 'admin@llun.test'
  })
}))

jest.mock('@/lib/config', () => ({
  getConfig: () => ({ host: 'llun.test', allowEmails: [] })
}))

describe('/api/v1/admin/domain_blocks', () => {
  beforeEach(() => {
    mockDatabase.getDomainBlocks.mockReset()
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

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks'),
      { params: Promise.resolve({}) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
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
        headers: { 'content-type': 'application/json' },
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
})
