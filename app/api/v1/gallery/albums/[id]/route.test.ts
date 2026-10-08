import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedGalleryRouteFixtures } from '@/lib/services/gallery/galleryRouteFixtures'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { ERROR_429 } from '@/lib/utils/response'

import { DELETE, GET, OPTIONS, PATCH } from './route'

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

const signIn = (email: string) =>
  mockGetServerSession.mockResolvedValue({ user: { email } })

const url = (id: string, query = '') =>
  `https://llun.test/api/v1/gallery/albums/${id}${query}`

const get = (id: string, query = '') =>
  GET(new NextRequest(url(id, query), { method: 'GET' }), {
    params: Promise.resolve({ id })
  })

const write = (method: 'PATCH' | 'DELETE', id: string, body?: unknown) =>
  (method === 'PATCH' ? PATCH : DELETE)(
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

describe('/api/v1/gallery/albums/[id]', () => {
  const { database, prepare } = getTestDatabaseWithInstance()
  let ids: Record<string, string> = {}
  let albumId = ''

  const createAlbum = async (title: string, mediaNames: string[] = []) => {
    const created = await database.createGalleryAlbumWithinLimit({
      actorId: ACTOR1_ID,
      title,
      limit: 200
    })
    if (created.status !== 'created') throw new Error('not created')
    if (mediaNames.length > 0) {
      await database.addGalleryAlbumItems({
        albumId: created.album.id,
        actorId: ACTOR1_ID,
        mediaIds: mediaNames.map((name) => ids[name]),
        limit: 2000
      })
    }
    return created.album.id
  }

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    ids = await seedGalleryRouteFixtures(database)
    mockDatabase = database
    albumId = await createAlbum('Detail', ['kingfisher', 'fox', 'heron'])
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
    it('advertises GET, PATCH, DELETE and OPTIONS', async () => {
      const response = await OPTIONS(
        new NextRequest(url(albumId), { method: 'OPTIONS' })
      )

      for (const method of ['GET', 'PATCH', 'DELETE', 'OPTIONS']) {
        allowsMethod(response, method)
      }
    })
  })

  describe('without a session', () => {
    // The wiring test pins the guard on every method; this checks that the
    // error carries the route's CORS headers.
    it('answers 401 with CORS headers', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const response = await get(albumId)

      expect(response.status).toBe(401)
      allowsMethod(response, 'GET')
    })
  })

  describe('GET', () => {
    it('answers the album, its public facts, species chips and the first page', async () => {
      const response = await get(albumId)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.album).toMatchObject({
        id: albumId,
        title: 'Detail',
        // The owner sees all three, the heron's followers-only post included.
        itemCount: 3
      })
      // What a visitor would see: the heron's post is followers-only.
      expect(body.facts).toMatchObject({
        photoCount: 2,
        speciesCount: 2
      })
      expect(
        body.species.map((chip: { name: string }) => chip.name).sort()
      ).toEqual(['Grey Heron', 'Kingfisher', 'Red Fox'])
      expect(body.page.items).toHaveLength(3)
      expect(body.page.nextMaxId).toBeNull()
      // Every stored item, for the add dialog's room left in the album.
      expect(body.storedItemCount).toBe(3)
    })

    it('pages with the limit and a cursor', async () => {
      const first = await (await get(albumId, '?limit=2&sort=taken_asc')).json()
      expect(
        first.page.items.map((item: { mediaId: string }) => item.mediaId)
      ).toEqual([ids.fox, ids.kingfisher])
      expect(first.page.nextMaxId).toBeString()
    })

    it('answers 404 for a missing album and for another account album alike', async () => {
      const missing = await get('missing')
      signIn(seedActor2.email)
      const foreign = await get(albumId)

      expect(missing.status).toBe(404)
      expect(foreign.status).toBe(404)
      expect(await foreign.json()).toEqual(await missing.json())
      allowsMethod(missing, 'GET')
    })

    it('answers 422 for a bad sort', async () => {
      const response = await get(albumId, '?sort=random')
      expect(response.status).toBe(422)
      allowsMethod(response, 'GET')
    })

    it('shows the owner of a private album the numbers a visitor would see', async () => {
      const id = await createAlbum('Private facts', ['kingfisher', 'fox'])
      await write('PATCH', id, { visibility: 'private' })

      const body = await (await get(id)).json()

      expect(body.album).toMatchObject({ visibility: 'private', itemCount: 2 })
      expect(body.facts).toMatchObject({ photoCount: 2, speciesCount: 2 })
    })
  })

  describe('PATCH', () => {
    it('edits the given fields', async () => {
      const id = await createAlbum('Before', ['kingfisher'])

      const response = await write('PATCH', id, {
        title: 'After',
        description: '  Notes  ',
        visibility: 'private',
        sort_order: 'added_desc',
        cover_media_id: ids.kingfisher
      })

      expect(response.status).toBe(200)
      // One hit, counted for the signed-in actor.
      expect(takeMock).toHaveBeenCalledTimes(1)
      expect(takeMock).toHaveBeenCalledWith(ACTOR1_ID)
      const { album } = await response.json()
      expect(album).toMatchObject({
        id,
        title: 'After',
        description: 'Notes',
        visibility: 'private',
        sortOrder: 'added_desc',
        coverMediaId: ids.kingfisher,
        cover: { mediaId: ids.kingfisher }
      })

      const cleared = await (
        await write('PATCH', id, { description: '', cover_media_id: null })
      ).json()
      expect(cleared.album).toMatchObject({
        description: null,
        coverMediaId: null
      })
    })

    it('answers 422 when the cover is not one of the album photos', async () => {
      const id = await createAlbum('Cover', ['kingfisher'])

      const response = await write('PATCH', id, { cover_media_id: ids.fox })

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({
        error: 'The cover must be a photo in the album'
      })
    })

    it.each([
      ['an empty body', {}],
      ['a blank title', { title: ' ' }],
      ['a long title', { title: 'x'.repeat(121) }],
      ['an unknown visibility', { visibility: 'followers' }],
      ['a cover that is not a number', { cover_media_id: 'abc' }],
      ['a body that is not JSON', 'nope']
    ])('answers 422 for %s', async (_, body) => {
      const response = await write('PATCH', albumId, body)
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: expect.any(String) })
      allowsMethod(response, 'PATCH')
      // A bad request uses up none of the write quota.
      expect(takeMock).not.toHaveBeenCalled()
    })

    it('answers 404 for a missing and for another account album alike, even with a bad body', async () => {
      const missing = await write('PATCH', 'missing', { title: 'x' })
      signIn(seedActor2.email)
      const foreign = await write('PATCH', albumId, { title: 'Hijack' })
      const foreignBad = await write('PATCH', albumId, {})

      expect(missing.status).toBe(404)
      expect(foreign.status).toBe(404)
      expect(foreignBad.status).toBe(404)
      expect(takeMock).not.toHaveBeenCalled()
      allowsMethod(missing, 'PATCH')
      expect(await foreign.json()).toEqual(await missing.json())
      signIn(seedActor1.email)
      expect((await (await get(albumId)).json()).album.title).toBe('Detail')
    })

    it('checks the body before the write limit: a bad body is still 422 when over it', async () => {
      takeMock.mockReturnValue(false)

      const response = await write('PATCH', albumId, { title: ' ' })

      expect(response.status).toBe(422)
      expect(takeMock).not.toHaveBeenCalled()
    })

    it('checks the album before the write limit: another account album is 404 when over it', async () => {
      takeMock.mockReturnValue(false)
      signIn(seedActor2.email)

      const response = await write('PATCH', albumId, { title: 'Hijack' })

      expect(response.status).toBe(404)
      expect(takeMock).not.toHaveBeenCalled()
    })

    it('answers 429 over the write limit and changes nothing', async () => {
      takeMock.mockReturnValue(false)

      const response = await write('PATCH', albumId, { title: 'Changed' })

      expect(response.status).toBe(429)
      expect(await response.json()).toEqual(ERROR_429)
      allowsMethod(response, 'PATCH')
      takeMock.mockReturnValue(true)
      expect((await (await get(albumId)).json()).album.title).toBe('Detail')
    })
  })

  describe('DELETE', () => {
    it('deletes the album and keeps its photos', async () => {
      const id = await createAlbum('Doomed', ['kingfisher'])

      const response = await write('DELETE', id)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'OK' })
      expect(takeMock).toHaveBeenCalledTimes(1)
      expect(takeMock).toHaveBeenCalledWith(ACTOR1_ID)
      expect((await get(id)).status).toBe(404)
      expect(
        await database.getMediaByIdForAccount({
          mediaId: ids.kingfisher,
          accountId: (await database.getActorFromId({ id: ACTOR1_ID }))!
            .account!.id
        })
      ).not.toBeNull()
    })

    it('answers 404 for a missing and for another account album alike and deletes nothing', async () => {
      const id = await createAlbum('Safe')
      const missing = await write('DELETE', 'missing')
      signIn(seedActor2.email)
      const foreign = await write('DELETE', id)

      expect(missing.status).toBe(404)
      expect(foreign.status).toBe(404)
      expect(await foreign.json()).toEqual(await missing.json())
      expect(takeMock).not.toHaveBeenCalled()
      signIn(seedActor1.email)
      expect((await get(id)).status).toBe(200)
    })

    it('checks the album before the write limit: another account album is 404 when over it', async () => {
      const id = await createAlbum('Probed')
      takeMock.mockReturnValue(false)
      signIn(seedActor2.email)

      expect((await write('DELETE', id)).status).toBe(404)
      expect(takeMock).not.toHaveBeenCalled()
    })

    it('answers 429 over the write limit and deletes nothing', async () => {
      const id = await createAlbum('Throttled')
      takeMock.mockReturnValue(false)

      expect((await write('DELETE', id)).status).toBe(429)

      takeMock.mockReturnValue(true)
      expect((await get(id)).status).toBe(200)
    })
  })
})
