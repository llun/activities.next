import { NextRequest } from 'next/server'

import { DELETE } from './route'

const mockDatabase = {
  deleteDomainBlock: jest.fn()
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

describe('/api/v1/admin/domain_blocks/:id', () => {
  beforeEach(() => {
    mockDatabase.deleteDomainBlock.mockReset()
  })

  it('returns the deleted domain block', async () => {
    mockDatabase.deleteDomainBlock.mockResolvedValue({
      id: 'block-1',
      type: 'block',
      domain: 'blocked.test',
      severity: 'suspend',
      rejectMedia: false,
      rejectReports: false,
      privateComment: null,
      publicComment: null,
      obfuscate: false,
      source: null,
      createdAt: 0,
      updatedAt: 0
    })

    const response = await DELETE(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks/block-1', {
        method: 'DELETE'
      }),
      { params: Promise.resolve({ id: 'block-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toMatchObject({
      id: 'block-1',
      domain: 'blocked.test',
      severity: 'suspend'
    })
  })
})
