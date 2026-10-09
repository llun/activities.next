import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedGalleryRouteFixtures } from '@/lib/services/gallery/galleryRouteFixtures'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { ERROR_429 } from '@/lib/utils/response'

import { GET, OPTIONS } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase:
  ReturnType<typeof getTestDatabaseWithInstance>['database'] | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => () => ({ where: () => ({ first: () => null }) })
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

const takeMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/gallery/lookups/rateLimit', () => ({
  // Each counter reports its own limit with the hit, so a test can tell which
  // of the route support's counters the route used.
  createWindowCounter: ({ limit }: { limit: number }) => ({
    tryHit: (actorId: string) => takeMock(limit, actorId),
    reset: vi.fn()
  })
}))

const signIn = (email: string) =>
  mockGetServerSession.mockResolvedValue({ user: { email } })

const media = (mediaIds: string) =>
  GET(
    new NextRequest(
      `https://llun.test/api/v1/gallery/albums/suggestions/media?media_ids=${mediaIds}`,
      { method: 'GET' }
    ),
    { params: Promise.resolve({}) }
  )

describe('/api/v1/gallery/albums/suggestions/media', () => {
  const { database, prepare } = getTestDatabaseWithInstance()
  let ids: Record<string, string> = {}

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    ids = await seedGalleryRouteFixtures(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    signIn(seedActor1.email)
    takeMock.mockReturnValue(true)
  })

  describe('OPTIONS', () => {
    it('advertises GET and OPTIONS', async () => {
      const response = await OPTIONS(
        new NextRequest(
          'https://llun.test/api/v1/gallery/albums/suggestions/media',
          { method: 'OPTIONS' }
        )
      )

      const methods = response.headers.get('Access-Control-Allow-Methods')
      expect(methods).toContain('GET')
      expect(methods).toContain('OPTIONS')
    })
  })

  describe('GET', () => {
    it('answers 401 with CORS headers when nobody is signed in', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const response = await media(ids.fox)

      expect(response.status).toBe(401)
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
        'GET'
      )
    })

    it("returns the owner's photos in the order asked, leaving out ids that are not theirs", async () => {
      const response = await media(
        [ids.fox, '999999', ids.kingfisher, ids.heron].join(',')
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      // The heron is on a followers-only post: the owner still sees it.
      expect(
        body.items.map((item: { mediaId: string }) => item.mediaId)
      ).toEqual([ids.fox, ids.kingfisher, ids.heron])
      expect(takeMock).toHaveBeenCalledTimes(1)
      expect(takeMock).toHaveBeenCalledWith(120, ACTOR1_ID)
    })

    it("returns nothing of another account's photos", async () => {
      signIn(seedActor2.email)

      const response = await media([ids.fox, ids.kingfisher].join(','))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ items: [] })
    })

    it.each([
      ['no ids', ''],
      ['an id that is not a number', 'abc'],
      ['an empty id between two', '1,,2'],
      ['a negative id', '-1'],
      ['an id over ten digits', '12345678901'],
      [
        'more than 100 ids',
        Array.from({ length: 101 }, (_, index) => `${index + 1}`).join(',')
      ]
    ])('answers 422 for %s without using the read limit', async (_, value) => {
      const response = await media(value)

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: expect.any(String) })
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
        'GET'
      )
      expect(takeMock).not.toHaveBeenCalled()
    })

    it('answers 422 when the parameter is missing', async () => {
      const response = await GET(
        new NextRequest(
          'https://llun.test/api/v1/gallery/albums/suggestions/media',
          { method: 'GET' }
        ),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(422)
    })

    it('answers 429 over the read limit', async () => {
      takeMock.mockReturnValue(false)

      const response = await media(ids.fox)

      expect(response.status).toBe(429)
      expect(await response.json()).toEqual(ERROR_429)
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
        'GET'
      )
    })
  })
})
