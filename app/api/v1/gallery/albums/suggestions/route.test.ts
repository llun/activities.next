import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { getGalleryAlbumSuggestions } from '@/lib/services/gallery/galleryAlbumSuggestions'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
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

// The real service, wrapped so a test can see what the route handed it.
vi.mock(
  '@/lib/services/gallery/galleryAlbumSuggestions',
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import('@/lib/services/gallery/galleryAlbumSuggestions')
      >()
    return {
      ...original,
      getGalleryAlbumSuggestions: vi.fn(original.getGalleryAlbumSuggestions)
    }
  }
)

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

const suggestions = (query = '') =>
  GET(
    new NextRequest(
      `https://llun.test/api/v1/gallery/albums/suggestions${query}`,
      { method: 'GET' }
    ),
    { params: Promise.resolve({}) }
  )

describe('/api/v1/gallery/albums/suggestions', () => {
  const { database, prepare } = getTestDatabaseWithInstance()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    // Five photos of one species: a species series for ACTOR1.
    for (let index = 0; index < 5; index += 1) {
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: `/test/suggestions-route-${index}.jpg`,
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 }
        },
        details: {
          inGallery: true,
          subjectName: 'Barn swallow',
          subjectScientificName: 'Hirundo rustica',
          subjectCategory: 'bird',
          takenAt: Date.UTC(2025, index * 2, 5)
        }
      })
      const statusId = `${ACTOR1_ID}/statuses/suggestions-route-${index}`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'swallow'
      })
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: 'image/jpeg',
        url: `https://media.test/suggestions-route-${index}.jpg`,
        width: 100,
        height: 100,
        mediaId: media!.id
      })
    }
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
        new NextRequest('https://llun.test/api/v1/gallery/albums/suggestions', {
          method: 'OPTIONS'
        })
      )

      const methods = response.headers.get('Access-Control-Allow-Methods')
      expect(methods).toContain('GET')
      expect(methods).toContain('OPTIONS')
    })
  })

  describe('GET', () => {
    it('answers 401 with CORS headers when nobody is signed in', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const response = await suggestions()

      expect(response.status).toBe(401)
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
        'GET'
      )
      expect(getGalleryAlbumSuggestions).not.toHaveBeenCalled()
    })

    it("returns the signed-in owner's suggestions", async () => {
      const response = await suggestions()

      expect(response.status).toBe(200)
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
        'GET'
      )
      const body = await response.json()
      expect(body.suggestions).toHaveLength(1)
      expect(body.suggestions[0]).toMatchObject({
        id: 'species:sci:hirundo rustica',
        kind: 'species',
        title: 'Barn swallow',
        photoCount: 5,
        truncated: false
      })
      expect(body.suggestions[0].mediaIds).toHaveLength(5)
      expect(body.suggestions[0].preview.mediaId).toBe(
        body.suggestions[0].mediaIds[0]
      )
      // One hit, counted for the signed-in actor.
      expect(takeMock).toHaveBeenCalledTimes(1)
      expect(takeMock).toHaveBeenCalledWith(20, ACTOR1_ID)
    })

    it("does not suggest another account's photos", async () => {
      signIn(seedActor2.email)

      const response = await suggestions()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ suggestions: [] })
    })

    it('passes the viewer time zone to the service, and UTC when there is none', async () => {
      await suggestions('?time_zone=Asia%2FTokyo')
      await suggestions()

      expect(
        vi
          .mocked(getGalleryAlbumSuggestions)
          .mock.calls.map(([params]) => params.timeZone)
      ).toEqual(['Asia/Tokyo', undefined])
    })

    it.each([
      ['an unknown zone', '?time_zone=Mars%2FBase'],
      ['an offset instead of a named zone', '?time_zone=%2B05%3A30'],
      ['an empty zone', '?time_zone='],
      ['a zone over 64 characters', `?time_zone=${'A'.repeat(65)}`]
    ])('answers 422 for %s without using the read limit', async (_, query) => {
      const response = await suggestions(query)

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: expect.any(String) })
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
        'GET'
      )
      expect(takeMock).not.toHaveBeenCalled()
      expect(getGalleryAlbumSuggestions).not.toHaveBeenCalled()
    })

    it('answers 429 over the read limit and does no work', async () => {
      takeMock.mockReturnValue(false)

      const response = await suggestions()

      expect(response.status).toBe(429)
      expect(await response.json()).toEqual(ERROR_429)
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
        'GET'
      )
      expect(getGalleryAlbumSuggestions).not.toHaveBeenCalled()
    })
  })
})
