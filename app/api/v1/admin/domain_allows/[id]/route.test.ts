import { NextRequest } from 'next/server'

import { DELETE, GET } from './route'

const mockDatabase = {
  getDomainAllowById: vi.fn(),
  deleteDomainAllow: vi.fn()
}

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'admin@llun.test' }
  })
}))

const mockGetAdminFromSession = vi.fn()
vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: () => mockGetAdminFromSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: () => 'https://llun.test',
  getConfig: () => ({ host: 'llun.test', allowEmails: [] })
}))

describe('/api/v1/admin/domain_allows/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAdminFromSession.mockResolvedValue({
      id: 'admin',
      email: 'admin@llun.test'
    })
  })

  const allow = {
    id: 'allow-1',
    type: 'allow',
    domain: 'trusted.test',
    createdAt: Date.UTC(2025, 0, 2, 3, 4, 5),
    updatedAt: Date.UTC(2025, 0, 2, 3, 4, 5)
  }

  const request = (method: 'GET' | 'DELETE') =>
    new NextRequest('https://llun.test/api/v1/admin/domain_allows/allow-1', {
      method,
      headers: { Origin: 'https://llun.test' }
    })
  const context = { params: Promise.resolve({ id: 'allow-1' }) }

  describe('GET', () => {
    it('returns the allow in the admin shape', async () => {
      mockDatabase.getDomainAllowById.mockResolvedValue(allow)

      const response = await GET(request('GET'), context)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        id: 'allow-1',
        domain: 'trusted.test',
        created_at: '2025-01-02T03:04:05.000Z'
      })
      expect(mockDatabase.getDomainAllowById).toHaveBeenCalledWith('allow-1')
    })

    it('answers 404 when the allow does not exist', async () => {
      mockDatabase.getDomainAllowById.mockResolvedValue(null)

      const response = await GET(request('GET'), context)

      expect(response.status).toBe(404)
    })

    it('rejects a request that is not from an admin', async () => {
      mockGetAdminFromSession.mockResolvedValue(null)

      const response = await GET(request('GET'), context)

      expect(response.status).toBe(403)
      expect(mockDatabase.getDomainAllowById).not.toHaveBeenCalled()
    })
  })

  describe('DELETE', () => {
    it('removes the allow and returns the deleted record', async () => {
      mockDatabase.deleteDomainAllow.mockResolvedValue(allow)

      const response = await DELETE(request('DELETE'), context)

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        id: 'allow-1',
        domain: 'trusted.test'
      })
      expect(mockDatabase.deleteDomainAllow).toHaveBeenCalledWith('allow-1')
    })

    it('answers 404 when there is nothing to delete', async () => {
      mockDatabase.deleteDomainAllow.mockResolvedValue(null)

      const response = await DELETE(request('DELETE'), context)

      expect(response.status).toBe(404)
    })

    it('does not delete anything for a non-admin', async () => {
      mockGetAdminFromSession.mockResolvedValue(null)

      const response = await DELETE(request('DELETE'), context)

      expect(response.status).toBe(403)
      expect(mockDatabase.deleteDomainAllow).not.toHaveBeenCalled()
    })
  })
})
