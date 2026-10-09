import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import {
  GalleryAlbumMatrix,
  MATRIX_OWNER_EMAIL,
  MATRIX_OWNER_ID,
  seedGalleryAlbumMatrix
} from '@/lib/services/gallery/galleryAlbumMatrixFixtures'
import { PUBLIC_GALLERY_AUDIENCE } from '@/lib/services/gallery/galleryAudience'
import { getPublicPlace } from '@/lib/services/gallery/publicMediaDetails'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { seedActor3 } from '@/lib/stub/seed/actor3'
import { seedActor4 } from '@/lib/stub/seed/actor4'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { ERROR_404, ERROR_422, ERROR_429 } from '@/lib/utils/response'
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

const call = (
  accountId: string,
  albumId: string,
  query = '',
  headers: Record<string, string> = {}
) =>
  GET(
    new NextRequest(
      `https://llun.test/api/v1/accounts/${urlToId(accountId)}/gallery/albums/${encodeURIComponent(albumId)}${query}`,
      { method: 'GET', headers }
    ),
    { params: Promise.resolve({ id: urlToId(accountId), albumId }) }
  )

describe('GET /api/v1/accounts/:id/gallery/albums/:albumId', () => {
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

  const mediaIds = (body: { items: Array<{ mediaId: string }> }) =>
    body.items.map((item) => item.mediaId).sort()
  const named = (...names: string[]) =>
    names.map((name) => matrix.media[name]).sort()

  describe('OPTIONS', () => {
    it('advertises GET and OPTIONS', async () => {
      const response = await OPTIONS(
        new NextRequest(
          'https://llun.test/api/v1/accounts/x/gallery/albums/y',
          { method: 'OPTIONS' }
        )
      )

      for (const method of ['GET', 'OPTIONS']) {
        expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
          method
        )
      }
    })
  })

  describe('the photos each viewer sees of a mixed album', () => {
    // One photo per post kind: public, unlisted, followers only, direct, a
    // deleted post, and one not in the gallery.
    it.each([
      ['a logged-out caller', null, ['public', 'unlisted']],
      ['a stranger', seedActor2.email, ['public', 'unlisted']],
      ['a blocked account', seedActor4.email, ['public', 'unlisted']],
      ['a follower', seedActor3.email, ['public', 'unlisted', 'followers']],
      [
        'the owner',
        MATRIX_OWNER_EMAIL,
        ['public', 'unlisted', 'followers', 'direct']
      ]
    ])('shows %s the posts they may read', async (_, email, visible) => {
      signIn(email)

      const response = await call(matrix.ownerId, matrix.albums.mixed)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(mediaIds(body)).toEqual(named(...visible))
      expect(body.album.itemCount).toBe(visible.length)
      expect(body.facts.photoCount).toBe(visible.length)
      expect(body.album.id).toBe(matrix.albums.mixed)
      expect(body.album.title).toBe('Mixed')
      // The cover is a photo this viewer can open.
      expect(named(...visible)).toContain(body.album.cover.mediaId)
    })

    it('computes the date range, species and cover from the photos a logged-out caller can open', async () => {
      const body = await (
        await call(matrix.ownerId, matrix.albums.mixed)
      ).json()

      expect(body.album.firstAt).toBe('2026-01-10T12:00:00.000Z')
      expect(body.album.lastAt).toBe('2026-02-10T12:00:00.000Z')
      expect(body.facts).toMatchObject({
        photoCount: 2,
        speciesCount: 2,
        placeCount: 1,
        countryCodes: ['GB']
      })
      expect(body.species.map((chip: { name: string }) => chip.name)).toEqual([
        'Common Kingfisher',
        'Red Fox'
      ])
      // The owner chose the followers-only heron; a logged-out caller does
      // not get it.
      expect(body.album.cover.mediaId).not.toBe(matrix.media.followers)
      expect(body.album.coverMediaId).toBeNull()
      expect(JSON.stringify(body)).not.toContain('matrix-followers.jpg')
    })

    it('gives a follower the chosen cover and a longer date range', async () => {
      signIn(seedActor3.email)

      const body = await (
        await call(matrix.ownerId, matrix.albums.mixed)
      ).json()

      expect(body.album.cover.mediaId).toBe(matrix.media.followers)
      expect(body.album.lastAt).toBe('2026-03-10T12:00:00.000Z')
    })

    it('keeps owner-only fields out of a visitor response', async () => {
      for (const email of [null, seedActor3.email, seedActor2.email]) {
        signIn(email)
        const body = await (
          await call(matrix.ownerId, matrix.albums.places)
        ).json()
        const text = JSON.stringify(body)

        expect(body.album.hiddenPlaceCount).toBe(0)
        expect(body.album.coverMediaId).toBeNull()
        expect(text).not.toMatch(/subjectIucnCategory|subjectLookupStatus/i)
      }
    })
  })

  describe('which albums are there at all', () => {
    // Every way an album can be not there for a viewer is the same response.
    const notThere: Array<[string, keyof GalleryAlbumMatrix['albums']]> = [
      ['a private album', 'secret'],
      ['an empty album', 'empty'],
      ['an album of only followers-only photos', 'followersOnly'],
      ['an album of only direct-message photos', 'directOnly'],
      ['an album of only deleted or ungalleried photos', 'goneOnly']
    ]

    it.each(notThere)(
      'answers 404 for %s to a logged-out caller',
      async (_, key) => {
        const response = await call(matrix.ownerId, matrix.albums[key])

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual(ERROR_404)
      }
    )

    it.each(notThere.filter(([, key]) => key !== 'followersOnly'))(
      'answers 404 for %s to a follower too',
      async (_, key) => {
        signIn(seedActor3.email)

        const response = await call(matrix.ownerId, matrix.albums[key])

        expect(response.status).toBe(404)
      }
    )

    it('opens the followers-only album for a follower', async () => {
      signIn(seedActor3.email)

      const response = await call(matrix.ownerId, matrix.albums.followersOnly)

      expect(response.status).toBe(200)
      expect(mediaIds(await response.json())).toEqual(named('followers'))
    })

    it('lets the owner open every album of theirs', async () => {
      signIn(MATRIX_OWNER_EMAIL)

      for (const albumId of Object.values(matrix.albums)) {
        const response = await call(MATRIX_OWNER_ID, albumId)
        expect(response.status).toBe(200)
      }
    })

    it('answers every not-there case with the same status, body and headers', async () => {
      signIn(seedActor2.email)
      const responses = [
        // Not there for this viewer.
        await call(matrix.ownerId, matrix.albums.secret),
        await call(matrix.ownerId, matrix.albums.empty),
        await call(matrix.ownerId, matrix.albums.followersOnly),
        // Not there at all.
        await call(matrix.ownerId, 'no-such-album'),
        await call(matrix.ownerId, 'a'.repeat(129)),
        // Another account's album under this account's path.
        await call(ACTOR1_ID, matrix.albums.mixed),
        // No such account, and a remote one.
        await call('https://llun.test/users/nobody', matrix.albums.mixed),
        await call(EXTERNAL_ACTOR1, matrix.albums.mixed)
      ]

      for (const response of responses) {
        expect(response.status).toBe(404)
        expect(await response.clone().json()).toEqual(ERROR_404)
        expect(response.headers.get('Content-Type')).toBe(
          responses[0].headers.get('Content-Type')
        )
        expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
          responses[0].headers.get('Access-Control-Allow-Methods')
        )
      }
    })

    it('answers 400 for an empty album id', async () => {
      const response = await call(matrix.ownerId, '')

      expect(response.status).toBe(400)
    })

    it('does not open an album through another account', async () => {
      signIn(seedActor1.email)

      expect((await call(ACTOR1_ID, matrix.albums.mixed)).status).toBe(404)
    })
  })

  describe('places', () => {
    it('gives a visitor exactly getPublicPlace for each photo, and the same facts', async () => {
      const response = await call(matrix.ownerId, matrix.albums.places)
      const body = await response.json()
      const settings = await database.getGallerySettings({
        actorId: matrix.ownerId
      })
      const rows = await database.getGalleryAlbumIndex({
        albumId: matrix.albums.places,
        actorId: matrix.ownerId,
        audience: PUBLIC_GALLERY_AUDIENCE
      })

      expect(body.items).toHaveLength(7)
      for (const row of rows) {
        const item = body.items.find(
          (candidate: { mediaId: string }) => candidate.mediaId === row.id
        )
        // JSON drops `undefined`; `null` is a place that is not shown.
        expect(item.place ?? null).toEqual(
          JSON.parse(JSON.stringify(getPublicPlace(row, settings) ?? null))
        )
      }
      expect(body.facts).toMatchObject({
        placeCount: 3,
        countryCodes: ['TH', 'ZA']
      })
    })

    it('leaves out a threatened, failed-check, hidden-precision and hidden-zone place', async () => {
      const text = await (
        await call(matrix.ownerId, matrix.albums.places)
      ).text()

      for (const withheld of ['Hemis', 'Burrow', 'Home', 'Nest site']) {
        expect(text).not.toContain(withheld)
      }
      // The country of a withheld place is withheld with it.
      expect(text).not.toContain('"IN"')
    })

    it('shows the owner the places a visitor does not get', async () => {
      signIn(MATRIX_OWNER_EMAIL)

      const body = await (
        await call(MATRIX_OWNER_ID, matrix.albums.places)
      ).json()

      expect(JSON.stringify(body)).toContain('Hemis')
      expect(body.album.hiddenPlaceCount).toBe(2)
    })
  })

  describe('paging, sorting and filtering', () => {
    it('pages with limit and max_id, newest taken first by default', async () => {
      signIn(seedActor3.email)

      const seen: string[] = []
      let query = '?limit=1'
      for (let page = 0; page < 5; page += 1) {
        const body = await (
          await call(matrix.ownerId, matrix.albums.mixed, query)
        ).json()
        seen.push(
          ...body.items.map((item: { mediaId: string }) => item.mediaId)
        )
        if (!body.nextMaxId) break
        query = `?limit=1&max_id=${encodeURIComponent(body.nextMaxId)}`
      }

      expect(seen).toEqual([
        matrix.media.followers,
        matrix.media.unlisted,
        matrix.media.public
      ])
    })

    it('sorts oldest first on request', async () => {
      const body = await (
        await call(matrix.ownerId, matrix.albums.mixed, '?sort=taken_asc')
      ).json()

      expect(
        body.items.map((item: { mediaId: string }) => item.mediaId)
      ).toEqual([matrix.media.public, matrix.media.unlisted])
    })

    it('filters by a species key', async () => {
      const body = await (
        await call(
          matrix.ownerId,
          matrix.albums.mixed,
          `?subject=${encodeURIComponent('sci:alcedo atthis')}`
        )
      ).json()

      expect(mediaIds(body)).toEqual(named('public'))
    })

    it('clamps an out-of-range limit instead of rejecting it', async () => {
      expect(
        (await call(matrix.ownerId, matrix.albums.mixed, '?limit=0')).status
      ).toBe(200)
      expect(
        (await call(matrix.ownerId, matrix.albums.mixed, '?limit=9999')).status
      ).toBe(200)
    })

    it.each([
      ['a non-numeric max_id', '?max_id=abc'],
      ['an over-long max_id', '?max_id=12345678901234567:1'],
      ['an unknown sort', '?sort=random'],
      ['an empty subject', '?subject='],
      ['an over-long subject', `?subject=${'a'.repeat(521)}`]
    ])('answers 422 for %s', async (_, query) => {
      const response = await call(matrix.ownerId, matrix.albums.mixed, query)

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual(ERROR_422)
    })

    it('answers 404 before it looks at a bad query, so a probe learns nothing from a 422', async () => {
      const response = await call(
        matrix.ownerId,
        matrix.albums.secret,
        '?sort=random'
      )

      expect(response.status).toBe(404)
    })
  })

  describe('rate limit', () => {
    it('answers 429 with CORS headers to a signed-in caller over the limit', async () => {
      signIn(seedActor2.email)
      takeMock.mockReturnValue(false)

      const response = await call(matrix.ownerId, matrix.albums.mixed, '', {
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

    it('limits a logged-out caller by the trusted proxy address', async () => {
      trustProxyMock.mockReturnValue(true)
      takeMock.mockReturnValue(false)

      const response = await call(matrix.ownerId, matrix.albums.mixed, '', {
        'cf-connecting-ip': '203.0.113.7'
      })

      expect(response.status).toBe(429)
      expect(takeMock).toHaveBeenCalledWith('ip:203.0.113.7')
    })

    it('answers 429 ahead of 404, so the limit cannot be sidestepped by probing', async () => {
      signIn(seedActor2.email)
      takeMock.mockReturnValue(false)

      const response = await call(matrix.ownerId, 'no-such-album')

      expect(response.status).toBe(429)
    })
  })
})
