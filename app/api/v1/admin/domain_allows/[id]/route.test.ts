import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'

import { DELETE, GET } from './route'

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => null
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
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAdminFromSession.mockResolvedValue({
      id: 'admin',
      email: 'admin@llun.test'
    })
  })

  const request = (id: string, method: 'GET' | 'DELETE') =>
    new NextRequest(`https://llun.test/api/v1/admin/domain_allows/${id}`, {
      method,
      headers: { Origin: 'https://llun.test' }
    })
  const context = (id: string) => ({ params: Promise.resolve({ id }) })

  describe('GET', () => {
    it('returns the allow in the admin shape', async () => {
      const allow = await database.createDomainAllow({
        domain: 'get-trusted.test'
      })

      const response = await GET(request(allow.id, 'GET'), context(allow.id))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        id: allow.id,
        domain: 'get-trusted.test',
        created_at: new Date(allow.createdAt).toISOString()
      })
    })

    it('answers 404 when the allow does not exist', async () => {
      const response = await GET(request('missing', 'GET'), context('missing'))

      expect(response.status).toBe(404)
    })

    it('answers 404 for the id of a domain block, which is not an allow', async () => {
      const block = await database.createDomainBlock({
        domain: 'get-blocked.test'
      })

      const response = await GET(request(block.id, 'GET'), context(block.id))

      expect(response.status).toBe(404)
    })

    it('rejects a request that is not from an admin', async () => {
      const allow = await database.createDomainAllow({
        domain: 'get-forbidden.test'
      })
      mockGetAdminFromSession.mockResolvedValue(null)

      const response = await GET(request(allow.id, 'GET'), context(allow.id))

      expect(response.status).toBe(403)
    })
  })

  describe('DELETE', () => {
    it('removes only that allow and returns the deleted record', async () => {
      const allow = await database.createDomainAllow({
        domain: 'delete-trusted.test'
      })
      const sibling = await database.createDomainAllow({
        domain: 'delete-sibling.test'
      })

      const response = await DELETE(
        request(allow.id, 'DELETE'),
        context(allow.id)
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        id: allow.id,
        domain: 'delete-trusted.test'
      })
      expect(await database.getDomainAllowById(allow.id)).toBeNull()
      expect(await database.getDomainAllowById(sibling.id)).not.toBeNull()
    })

    it('answers 404 when there is nothing to delete', async () => {
      const response = await DELETE(
        request('missing', 'DELETE'),
        context('missing')
      )

      expect(response.status).toBe(404)
    })

    it('does not delete a domain block addressed by its id', async () => {
      const block = await database.createDomainBlock({
        domain: 'delete-blocked.test'
      })

      const response = await DELETE(
        request(block.id, 'DELETE'),
        context(block.id)
      )

      expect(response.status).toBe(404)
      expect(await database.getDomainBlockById(block.id)).not.toBeNull()
    })

    it('does not delete anything for a non-admin', async () => {
      const allow = await database.createDomainAllow({
        domain: 'delete-forbidden.test'
      })
      mockGetAdminFromSession.mockResolvedValue(null)

      const response = await DELETE(
        request(allow.id, 'DELETE'),
        context(allow.id)
      )

      expect(response.status).toBe(403)
      expect(await database.getDomainAllowById(allow.id)).not.toBeNull()
    })
  })
})
