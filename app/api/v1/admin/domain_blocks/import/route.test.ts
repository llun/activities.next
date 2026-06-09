import { NextRequest } from 'next/server'

import { POST } from './route'

const mockDatabase = {
  importDomainBlocks: jest.fn()
}
const mockDownloadKnownDomainBlocklist = jest.fn()

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
  getBaseURL: () => 'https://llun.test',
  getConfig: () => ({ host: 'llun.test', allowEmails: [] })
}))

jest.mock('@/lib/services/federation/blocklistSources', () => {
  const actual = jest.requireActual(
    '@/lib/services/federation/blocklistSources'
  )

  return {
    ...actual,
    downloadKnownDomainBlocklist: (...params: unknown[]) =>
      mockDownloadKnownDomainBlocklist(...params)
  }
})

describe('/api/v1/admin/domain_blocks/import', () => {
  beforeEach(() => {
    mockDatabase.importDomainBlocks.mockReset()
    mockDownloadKnownDomainBlocklist.mockReset()
  })

  it('imports a known blocklist source', async () => {
    mockDownloadKnownDomainBlocklist.mockResolvedValue([
      {
        domain: 'bad.test',
        severity: 'suspend',
        rejectMedia: false,
        rejectReports: false,
        publicComment: 'spam',
        privateComment: null,
        obfuscate: false,
        source: 'oliphant-tier0'
      }
    ])
    mockDatabase.importDomainBlocks.mockResolvedValue({
      created: 1,
      updated: 0,
      skipped: 0
    })

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks/import', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Origin: 'https://llun.test'
        },
        body: JSON.stringify({ source: 'oliphant-tier0' })
      }),
      { params: Promise.resolve({}) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockDownloadKnownDomainBlocklist).toHaveBeenCalledWith(
      'oliphant-tier0'
    )
    expect(mockDatabase.importDomainBlocks).toHaveBeenCalledWith({
      blocks: expect.arrayContaining([
        expect.objectContaining({ domain: 'bad.test' })
      ])
    })
    expect(data).toEqual({
      source: 'oliphant-tier0',
      fetched: 1,
      created: 1,
      updated: 0,
      skipped: 0
    })
  })

  it('returns bad request when import fails', async () => {
    mockDownloadKnownDomainBlocklist.mockRejectedValue(
      new Error('download failed')
    )

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks/import', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Origin: 'https://llun.test'
        },
        body: JSON.stringify({ source: 'oliphant-tier0' })
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(mockDatabase.importDomainBlocks).not.toHaveBeenCalled()
  })
})
