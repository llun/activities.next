import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { DELETE, GET, POST } from './route'

const mockGetServerSession = jest.fn()
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args)
}))

jest.mock('../../../../auth/[...nextauth]/authOptions', () => ({
  getAuthOptions: jest.fn(() => ({}))
}))

jest.mock('../../../../../../lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: [],
    allowActorDomains: []
  })
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('../../../../../../lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: () => undefined
  })
}))

describe('Strava Settings API', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    mockGetServerSession.mockReset()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  describe('GET /api/v1/settings/fitness/strava', () => {
    it('returns configured: false when no settings exist', async () => {
      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/strava',
        {
          method: 'GET'
        }
      )

      const response = await GET(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.configured).toBe(false)
    })

    it('returns clientId without secret when configured', async () => {
      await database.updateActor({
        actorId: ACTOR1_ID,
        fitness: {
          strava: {
            clientId: '12345',
            clientSecret: 'secret123'
          }
        }
      })

      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/strava',
        {
          method: 'GET'
        }
      )

      const response = await GET(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.configured).toBe(true)
      expect(data.clientId).toBe('12345')
      expect(data.clientSecret).toBeUndefined()
    })
  })

  describe('POST /api/v1/settings/fitness/strava', () => {
    it('saves valid Strava settings', async () => {
      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/strava',
        {
          method: 'POST',
          body: JSON.stringify({
            clientId: '54321',
            clientSecret: 'newsecret456'
          })
        }
      )

      const response = await POST(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)

      const settings = await database.getActorSettings({ actorId: ACTOR1_ID })
      expect(settings?.fitness?.strava?.clientId).toBe('54321')
      expect(settings?.fitness?.strava?.clientSecret).toBe('newsecret456')
    })

    it('rejects non-numeric client ID', async () => {
      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/strava',
        {
          method: 'POST',
          body: JSON.stringify({
            clientId: 'abc123',
            clientSecret: 'secret'
          })
        }
      )

      const response = await POST(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('numeric')
    })

    it('rejects empty client secret', async () => {
      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/strava',
        {
          method: 'POST',
          body: JSON.stringify({
            clientId: '12345',
            clientSecret: ''
          })
        }
      )

      const response = await POST(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBeDefined()
    })
  })

  describe('DELETE /api/v1/settings/fitness/strava', () => {
    it('removes existing Strava settings', async () => {
      await database.updateActor({
        actorId: ACTOR1_ID,
        fitness: {
          strava: {
            clientId: '99999',
            clientSecret: 'deleteme'
          }
        }
      })

      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/strava',
        {
          method: 'DELETE'
        }
      )

      const response = await DELETE(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)

      const settings = await database.getActorSettings({ actorId: ACTOR1_ID })
      expect(settings?.fitness?.strava).toBeUndefined()
    })

    it('returns 404 when no settings exist', async () => {
      const settings = await database.getActorSettings({ actorId: ACTOR1_ID })
      if (settings?.fitness?.strava) {
        await database.updateActor({
          actorId: ACTOR1_ID,
          fitness: {}
        })
      }

      const request = new NextRequest(
        'http://llun.test/api/v1/settings/fitness/strava',
        {
          method: 'DELETE'
        }
      )

      const response = await DELETE(request, { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toContain('No Strava settings')
    })
  })
})
