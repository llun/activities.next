import { NextRequest } from 'next/server'

import { POST } from './route'

const mockDatabase = {
  importDomainBlocks: jest.fn()
}
const mockFetchKnownDomainBlocklist = jest.fn()

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

jest.mock('@/lib/services/federation/blocklistSources', () => {
  const actual = jest.requireActual(
    '@/lib/services/federation/blocklistSources'
  )

  return {
    ...actual,
    fetchKnownDomainBlocklist: (...params: unknown[]) =>
      mockFetchKnownDomainBlocklist(...params)
  }
})

describe('/api/v1/admin/domain_blocks/import', () => {
  beforeEach(() => {
    mockDatabase.importDomainBlocks.mockReset()
    mockFetchKnownDomainBlocklist.mockReset()
  })

  it('returns bad request when import fails', async () => {
    mockFetchKnownDomainBlocklist.mockRejectedValue(new Error('fetch failed'))

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'oliphant-tier0' })
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(mockDatabase.importDomainBlocks).not.toHaveBeenCalled()
  })
})
