import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedGalleryRouteFixtures } from '@/lib/services/gallery/galleryRouteFixtures'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { ERROR_429 } from '@/lib/utils/response'

import { DELETE, GET, OPTIONS, POST } from './route'

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
  createWindowCounter: () => ({ tryHit: takeMock, reset: vi.fn() })
}))

// The cap is 2000 photos; the route reads it from here, so a tiny one tests
// the "422 and adds nothing" path without posting two thousand photos.
vi.mock('@/lib/types/database/galleryAlbums', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/types/database/galleryAlbums')
  >()),
  MAX_GALLERY_ALBUM_ITEMS: 2
}))

const signIn = (email: string) =>
  mockGetServerSession.mockResolvedValue({ user: { email } })

const url = (id: string, query = '') =>
  `https://llun.test/api/v1/gallery/albums/${id}/items${query}`

const get = (id: string, query = '') =>
  GET(new NextRequest(url(id, query), { method: 'GET' }), {
    params: Promise.resolve({ id })
  })

const write = (method: 'POST' | 'DELETE', id: string, body?: unknown) =>
  (method === 'POST' ? POST : DELETE)(
    new NextRequest(url(id), {
      method,
      headers: {
        origin: 'https://llun.test',
        'content-type': 'application/json'
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) })
    }),
    { params: Promise.resolve({ id }) }
  )

describe('/api/v1/gallery/albums/[id]/items', () => {
  const { database, prepare } = getTestDatabaseWithInstance()
  let ids: Record<string, string> = {}

  const createAlbum = async (title: string) => {
    const created = await database.createGalleryAlbumWithinLimit({
      actorId: ACTOR1_ID,
      title,
      limit: 200
    })
    if (created.status !== 'created') throw new Error('not created')
    return created.album.id
  }

  const mediaIdsOf = async (id: string, query = '') =>
    (await (await get(id, query)).json()).items.map(
      (item: { mediaId: string }) => item.mediaId
    )

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

  const allowsMethod = (response: Response, method: string) =>
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      method
    )

  describe('OPTIONS', () => {
    it('advertises GET, POST, DELETE and OPTIONS', async () => {
      const response = await OPTIONS(
        new NextRequest(url('any'), { method: 'OPTIONS' })
      )

      for (const method of ['GET', 'POST', 'DELETE', 'OPTIONS']) {
        allowsMethod(response, method)
      }
    })
  })

  describe('without a session', () => {
    // The wiring test pins the guard on every method; this checks that the
    // error carries the route's CORS headers.
    it('answers 401 with CORS headers', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const response = await get('any')

      expect(response.status).toBe(401)
      allowsMethod(response, 'GET')
    })
  })

  describe('POST', () => {
    it('adds the owner own photos, reports repeats and skips the rest', async () => {
      const id = await createAlbum('Add')

      const first = await write('POST', id, {
        media_ids: [ids.kingfisher, '999999']
      })
      expect(first.status).toBe(200)
      // One hit, counted for the signed-in actor.
      expect(takeMock).toHaveBeenCalledTimes(1)
      expect(takeMock).toHaveBeenCalledWith(ACTOR1_ID)
      expect(await first.json()).toMatchObject({
        added: [ids.kingfisher],
        existing: [],
        skipped: ['999999'],
        album: { id, itemCount: 1 }
      })

      const again = await (
        await write('POST', id, { media_ids: [ids.kingfisher, ids.fox] })
      ).json()
      expect(again).toMatchObject({
        added: [ids.fox],
        existing: [ids.kingfisher],
        album: { itemCount: 2 }
      })
    })

    it('skips media of another account', async () => {
      const id = await createAlbum('Foreign')
      // ACTOR2 owns no gallery media, so ACTOR1's ids are foreign to them.
      const other = await database.createGalleryAlbumWithinLimit({
        actorId: (await database.getActorFromEmail({
          email: seedActor2.email
        }))!.id,
        title: 'Theirs',
        limit: 200
      })
      if (other.status !== 'created') throw new Error('not created')
      signIn(seedActor2.email)

      const response = await write('POST', other.album.id, {
        media_ids: [ids.kingfisher]
      })

      expect(await response.json()).toMatchObject({
        added: [],
        skipped: [ids.kingfisher]
      })
      signIn(seedActor1.email)
      expect(await mediaIdsOf(id)).toEqual([])
    })

    it('answers 422 and adds nothing past the album cap', async () => {
      const id = await createAlbum('Cap')
      await write('POST', id, { media_ids: [ids.kingfisher] })

      const response = await write('POST', id, {
        media_ids: [ids.fox, ids.lakes]
      })

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({
        error: 'Too many photos in this album'
      })
      expect(await mediaIdsOf(id)).toEqual([ids.kingfisher])
    })

    it.each([
      ['no media_ids', {}],
      ['an empty media_ids', { media_ids: [] }],
      [
        'more than 100 ids',
        { media_ids: Array.from({ length: 101 }, (_, index) => `${index + 1}`) }
      ],
      ['an id that is not a number', { media_ids: ['x'] }],
      ['a body that is not JSON', 'nope']
    ])('answers 422 for %s', async (_, body) => {
      const id = await createAlbum('Invalid')
      const response = await write('POST', id, body)
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: expect.any(String) })
      allowsMethod(response, 'POST')
      // A bad request uses up none of the write quota.
      expect(takeMock).not.toHaveBeenCalled()
    })

    it('checks the body before the write limit: a bad body is still 422 when over it', async () => {
      const id = await createAlbum('Invalid over the limit')
      takeMock.mockReturnValue(false)

      const response = await write('POST', id, { media_ids: [] })

      expect(response.status).toBe(422)
      expect(takeMock).not.toHaveBeenCalled()
    })

    it('checks the album before the write limit: another account album is 404 when over it', async () => {
      const id = await createAlbum('Probed')
      takeMock.mockReturnValue(false)
      signIn(seedActor2.email)

      const response = await write('POST', id, { media_ids: [ids.kingfisher] })

      expect(response.status).toBe(404)
      expect(takeMock).not.toHaveBeenCalled()
    })

    it('answers 404 for a missing and for another account album alike', async () => {
      const id = await createAlbum('Private')
      const missing = await write('POST', 'missing', {
        media_ids: [ids.kingfisher]
      })
      signIn(seedActor2.email)
      const foreign = await write('POST', id, { media_ids: [ids.kingfisher] })

      expect(missing.status).toBe(404)
      expect(foreign.status).toBe(404)
      expect(await foreign.json()).toEqual(await missing.json())
      expect(takeMock).not.toHaveBeenCalled()
      allowsMethod(missing, 'POST')
      signIn(seedActor1.email)
      expect(await mediaIdsOf(id)).toEqual([])
    })

    it('answers 429 over the write limit and adds nothing', async () => {
      const id = await createAlbum('Throttled')
      takeMock.mockReturnValue(false)

      const response = await write('POST', id, { media_ids: [ids.kingfisher] })

      expect(response.status).toBe(429)
      expect(await response.json()).toEqual(ERROR_429)
      allowsMethod(response, 'POST')
      takeMock.mockReturnValue(true)
      expect(await mediaIdsOf(id)).toEqual([])
    })
  })

  describe('DELETE', () => {
    it('removes photos from the album and keeps the photos', async () => {
      const id = await createAlbum('Remove')
      await write('POST', id, { media_ids: [ids.kingfisher, ids.fox] })

      const response = await write('DELETE', id, {
        media_ids: [ids.kingfisher, ids.lakes]
      })

      expect(response.status).toBe(200)
      expect(takeMock).toHaveBeenCalledTimes(2)
      expect(takeMock).toHaveBeenLastCalledWith(ACTOR1_ID)
      expect(await response.json()).toMatchObject({
        removed: [ids.kingfisher],
        album: { itemCount: 1 }
      })
      expect(await mediaIdsOf(id)).toEqual([ids.fox])
      expect(
        await database.getMediaByIdForAccount({
          mediaId: ids.kingfisher,
          accountId: (await database.getActorFromId({ id: ACTOR1_ID }))!
            .account!.id
        })
      ).not.toBeNull()
    })

    it('answers 404 for a foreign album and 422 for a bad body', async () => {
      const id = await createAlbum('Remove foreign')
      expect((await write('DELETE', id, { media_ids: [] })).status).toBe(422)
      signIn(seedActor2.email)
      expect(
        (await write('DELETE', id, { media_ids: [ids.kingfisher] })).status
      ).toBe(404)
      expect(takeMock).not.toHaveBeenCalled()
    })

    it('checks the album and the body before the write limit', async () => {
      const id = await createAlbum('Remove order')
      takeMock.mockReturnValue(false)

      expect((await write('DELETE', id, { media_ids: [] })).status).toBe(422)
      signIn(seedActor2.email)
      expect(
        (await write('DELETE', id, { media_ids: [ids.kingfisher] })).status
      ).toBe(404)
      expect(takeMock).not.toHaveBeenCalled()
    })

    it('answers 429 over the write limit', async () => {
      const id = await createAlbum('Remove throttled')
      takeMock.mockReturnValue(false)
      expect(
        (await write('DELETE', id, { media_ids: [ids.kingfisher] })).status
      ).toBe(429)
    })
  })

  describe('GET', () => {
    it('pages through the album in the requested order with a cursor', async () => {
      const id = await createAlbum('Pages')
      await database.addGalleryAlbumItems({
        albumId: id,
        actorId: ACTOR1_ID,
        mediaIds: [ids.kingfisher, ids.fox, ids.heron],
        limit: 2000
      })

      const first = await (await get(id, '?limit=2&sort=taken_desc')).json()
      expect(
        first.items.map((item: { mediaId: string }) => item.mediaId)
      ).toEqual([ids.heron, ids.kingfisher])
      expect(first.nextMaxId).toBeString()

      const second = await (
        await get(id, `?limit=2&sort=taken_desc&max_id=${first.nextMaxId}`)
      ).json()
      expect(
        second.items.map((item: { mediaId: string }) => item.mediaId)
      ).toEqual([ids.fox])
      expect(second.nextMaxId).toBeNull()
    })

    it('filters to one species', async () => {
      const id = await createAlbum('Species')
      await database.addGalleryAlbumItems({
        albumId: id,
        actorId: ACTOR1_ID,
        mediaIds: [ids.kingfisher, ids.fox],
        limit: 2000
      })

      expect(await mediaIdsOf(id, '?subject=name%3Ared%20fox')).toEqual([
        ids.fox
      ])
    })

    it('answers 422 for a malformed cursor', async () => {
      const id = await createAlbum('Cursor')
      const response = await get(id, '?max_id=abc')
      expect(response.status).toBe(422)
    })

    it('answers 404 for a missing and for another account album alike', async () => {
      const id = await createAlbum('Read foreign')
      const missing = await get('missing')
      signIn(seedActor2.email)
      const foreign = await get(id)

      expect(missing.status).toBe(404)
      expect(foreign.status).toBe(404)
      expect(await foreign.json()).toEqual(await missing.json())
    })
  })
})
