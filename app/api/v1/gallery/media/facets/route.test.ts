import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedGalleryRouteFixtures } from '@/lib/services/gallery/galleryRouteFixtures'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET, OPTIONS } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase:
  ReturnType<typeof getTestDatabaseWithInstance>['database'] | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi
    .fn()
    .mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) })
}))

vi.mock('better-auth/oauth2', () => ({ verifyBearerToken: vi.fn() }))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const signIn = (email: string) =>
  mockGetServerSession.mockResolvedValue({ user: { email } })

const getFacets = (query?: string) =>
  GET(
    new NextRequest(
      `https://llun.test/api/v1/gallery/media/facets${query ? `?${query}` : ''}`,
      {
        method: 'GET',
        headers: {
          origin: 'https://llun.test'
        }
      }
    ),
    { params: Promise.resolve({}) }
  )

describe('/api/v1/gallery/media/facets', () => {
  const { database, prepare } = getTestDatabaseWithInstance()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    await seedGalleryRouteFixtures(database)
    mockDatabase = database

    // Seed media for Actor 2
    const m2 = await database.createMedia({
      actorId: ACTOR2_ID,
      original: {
        path: '/test/route-actor2.jpg',
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 100, height: 100 }
      },
      details: { inGallery: true, placeName: 'Forest' }
    })
    const status2 = `${ACTOR2_ID}/statuses/actor2-status`
    await database.createNote({
      id: status2,
      url: status2,
      actorId: ACTOR2_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'actor2 post'
    })
    await database.createAttachment({
      actorId: ACTOR2_ID,
      statusId: status2,
      mediaType: 'image/jpeg',
      url: 'https://media.test/route-actor2.jpg',
      width: 100,
      height: 100,
      mediaId: m2!.id
    })
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    signIn(seedActor1.email)
  })

  describe('OPTIONS', () => {
    it('advertises GET and OPTIONS', async () => {
      const response = await OPTIONS(
        new NextRequest('https://llun.test/api/v1/gallery/media/facets', {
          method: 'OPTIONS'
        })
      )

      const methods = response.headers.get('Access-Control-Allow-Methods')
      expect(methods).toContain('GET')
      expect(methods).toContain('OPTIONS')
    })
  })

  describe('GET', () => {
    it('returns 422 on bad show param', async () => {
      const response = await getFacets('show=bogus')

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: expect.any(String) })
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
        'GET'
      )
    })

    it('returns valid GalleryMediaFacetsResponse shape for a seeded owner', async () => {
      const response = await getFacets()

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toMatchObject({
        total: expect.any(Number),
        species: expect.any(Array),
        places: expect.any(Array),
        noPlaceCount: expect.any(Number),
        months: expect.any(Array),
        activities: expect.any(Array),
        notFromActivityCount: expect.any(Number)
      })
      expect(data.total).toBe(4)
      expect(data.places).toEqual([
        expect.objectContaining({ name: 'River', count: 1 })
      ])
      expect(data.noPlaceCount).toBe(3)
      expect(data.notFromActivityCount).toBe(4)
    })

    it('a second account sees only its own counts', async () => {
      const r1 = await getFacets()
      expect(r1.status).toBe(200)
      const data1 = await r1.json()

      signIn(seedActor2.email)
      const r2 = await getFacets()
      expect(r2.status).toBe(200)
      const data2 = await r2.json()

      expect(data2).toMatchObject({
        total: 1,
        species: [],
        places: [{ name: 'Forest', count: 1 }],
        noPlaceCount: 0,
        months: [{ month: new Date().toISOString().slice(0, 7), count: 1 }],
        activities: [],
        notFromActivityCount: 1
      })
      expect(data2.total).not.toBe(data1.total)
      expect(
        data1.places.some((p: { name: string }) => p.name === 'Forest')
      ).toBe(false)
    })
  })
})
