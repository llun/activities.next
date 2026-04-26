import { NextRequest } from 'next/server'

import { POST } from './route'

const mockDatabase = {
  createDomainAllow: jest.fn()
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

describe('/api/v1/admin/domain_allows', () => {
  beforeEach(() => {
    mockDatabase.createDomainAllow.mockReset()
  })

  it('rejects invalid JSON bodies', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/admin/domain_allows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{'
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
    expect(mockDatabase.createDomainAllow).not.toHaveBeenCalled()
  })
})
