import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import {
  GalleryAlbumMatrix,
  MATRIX_OWNER_EMAIL,
  MATRIX_OWNER_ID,
  seedGalleryAlbumMatrix
} from '@/lib/services/gallery/galleryAlbumMatrixFixtures'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { seedActor3 } from '@/lib/stub/seed/actor3'
import { seedActor4 } from '@/lib/stub/seed/actor4'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { ERROR_404, ERROR_429 } from '@/lib/utils/response'
import { urlToId } from '@/lib/utils/urlToId'

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

const trustProxyMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/config/trustProxyIpHeaders', () => ({
  getTrustProxyIpHeadersConfig: () => trustProxyMock()
}))

const takeMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/gallery/lookups/rateLimit', () => ({
  createWindowCounter: () => ({ tryHit: takeMock, reset: vi.fn() })
}))

const signIn = (email: string | null) =>
  mockGetServerSession.mockResolvedValue(email ? { user: { email } } : null)

const call = (accountId: string, headers: Record<string, string> = {}) =>
  GET(
    new NextRequest(
      `https://llun.test/api/v1/accounts/${urlToId(accountId)}/gallery/albums`,
      { method: 'GET', headers }
    ),
    { params: Promise.resolve({ id: urlToId(accountId) }) }
  )

describe('GET /api/v1/accounts/:id/gallery/albums', () => {
  const { database, prepare } = getTestDatabaseWithInstance()
  let matrix: GalleryAlbumMatrix

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    matrix = await seedGalleryAlbumMatrix(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    signIn(null)
    takeMock.mockReturnValue(true)
    trustProxyMock.mockReturnValue(false)
  })

  const listed = async (response: Response) => {
    const body = await response.json()
    return {
      ids: (body.albums as Array<{ id: string }>)
        .map((album) => album.id)
        .sort(),
      byId: Object.fromEntries(
        (body.albums as Array<{ id: string; itemCount: number }>).map(
          (album) => [album.id, album.itemCount]
        )
      ) as Record<string, number>,
      photoCount: body.photoCount as number,
      body
    }
  }

  describe('OPTIONS', () => {
    it('advertises GET and OPTIONS', async () => {
      const response = await OPTIONS(
        new NextRequest('https://llun.test/api/v1/accounts/x/gallery/albums', {
          method: 'OPTIONS'
        })
      )

      for (const method of ['GET', 'OPTIONS']) {
        expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
          method
        )
      }
    })
  })

  describe('which account', () => {
    it.each([
      ['a missing actor', 'https://llun.test/users/nobody'],
      ['a remote actor', EXTERNAL_ACTOR1]
    ])('answers 404 for %s, with CORS headers', async (_, accountId) => {
      const response = await call(accountId)

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual(ERROR_404)
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
        'GET'
      )
    })

    it('answers 400 for an empty account id', async () => {
      const response = await GET(
        new NextRequest('https://llun.test/api/v1/accounts//gallery/albums'),
        { params: Promise.resolve({ id: '' }) }
      )

      expect(response.status).toBe(400)
    })
  })

  describe('who is asking', () => {
    it('lists the public albums with something visible for a logged-out caller', async () => {
      const result = await listed(await call(matrix.ownerId))

      expect(result.ids).toEqual(
        [matrix.albums.mixed, matrix.albums.places].sort()
      )
      // Two of the six photos are on posts anyone can read.
      expect(result.byId[matrix.albums.mixed]).toBe(2)
      expect(result.photoCount).toBe(2 + 7)
    })

    it.each([
      ['a stranger', seedActor2.email],
      ['a blocked account', seedActor4.email]
    ])('gives %s the logged-out list', async (_, email) => {
      signIn(email)

      const result = await listed(await call(matrix.ownerId))

      expect(result.ids).toEqual(
        [matrix.albums.mixed, matrix.albums.places].sort()
      )
      expect(result.byId[matrix.albums.mixed]).toBe(2)
    })

    it('adds the followers-only album and photo for a follower', async () => {
      signIn(seedActor3.email)

      const result = await listed(await call(matrix.ownerId))

      expect(result.ids).toEqual(
        [
          matrix.albums.mixed,
          matrix.albums.followersOnly,
          matrix.albums.places
        ].sort()
      )
      expect(result.byId[matrix.albums.mixed]).toBe(3)
      expect(result.byId[matrix.albums.followersOnly]).toBe(1)
    })

    it('gives the owner every album, private and empty ones too', async () => {
      signIn(MATRIX_OWNER_EMAIL)

      const result = await listed(await call(MATRIX_OWNER_ID))

      expect(result.ids).toEqual(Object.values(matrix.albums).sort())
    })
  })

  describe('what a visitor is never told', () => {
    it.each([
      ['logged out', null],
      ['a follower', seedActor3.email],
      ['a stranger', seedActor2.email]
    ])(
      'leaves out owner-only fields and hidden places for %s',
      async (_, email) => {
        signIn(email)

        const { body } = await listed(await call(matrix.ownerId))
        const text = JSON.stringify(body)

        for (const album of body.albums) {
          expect(album.coverMediaId).toBeNull()
          expect(album.hiddenPlaceCount).toBe(0)
        }
        expect(text).not.toMatch(
          /subjectIucnCategory|subjectLookupStatus|IUCN|iucn/
        )
        // The threatened species' place, the failed check's and the hidden zone.
        for (const name of ['Hemis', 'Burrow', 'Nest site', 'Home']) {
          expect(text).not.toContain(name)
        }
        // No photo of a post the viewer cannot read, in a cover or a collage.
        expect(text).not.toContain('matrix-direct.jpg')
        expect(text).not.toContain('matrix-deleted.jpg')
        expect(text).not.toContain('matrix-hidden.jpg')
        if (email !== seedActor3.email) {
          expect(text).not.toContain('matrix-followers.jpg')
        }
      }
    )

    it('tells the owner how many places a visitor does not see', async () => {
      signIn(MATRIX_OWNER_EMAIL)

      const { body } = await listed(await call(MATRIX_OWNER_ID))

      const places = body.albums.find(
        (album: { id: string }) => album.id === matrix.albums.places
      )
      expect(places.hiddenPlaceCount).toBe(2)
    })
  })

  describe('rate limit', () => {
    it('answers 429 with CORS headers to a signed-in caller over the limit', async () => {
      signIn(seedActor2.email)
      takeMock.mockReturnValue(false)

      const response = await call(matrix.ownerId, {
        origin: 'https://llun.test'
      })

      expect(response.status).toBe(429)
      expect(await response.json()).toEqual(ERROR_429)
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
        'GET'
      )
      expect(takeMock).toHaveBeenCalledWith(
        `actor:${matrix.viewers.stranger.id}`
      )
    })

    it('counts a logged-out caller by the proxy address when the operator trusts it', async () => {
      trustProxyMock.mockReturnValue(true)
      takeMock.mockReturnValue(false)

      const response = await call(matrix.ownerId, {
        'x-forwarded-for': '203.0.113.9, 10.0.0.1'
      })

      expect(response.status).toBe(429)
      expect(takeMock).toHaveBeenCalledWith('ip:203.0.113.9')
    })

    it('does not limit a logged-out caller that has no trusted address', async () => {
      takeMock.mockReturnValue(false)

      const response = await call(matrix.ownerId, {
        'x-forwarded-for': '203.0.113.9'
      })

      // The header is spoofable unless the operator says a proxy sets it.
      expect(response.status).toBe(200)
      expect(takeMock).not.toHaveBeenCalled()
    })

    it('limits before it looks anything up', async () => {
      signIn(seedActor2.email)
      takeMock.mockReturnValue(false)

      // Even a missing account is 429 over the limit, not 404.
      const response = await call('https://llun.test/users/nobody')

      expect(response.status).toBe(429)
    })
  })
})
