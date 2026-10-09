import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedGalleryRouteFixtures } from '@/lib/services/gallery/galleryRouteFixtures'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'

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

const signIn = (email: string) =>
  mockGetServerSession.mockResolvedValue({ user: { email } })

const get = (id: string) =>
  GET(
    new NextRequest(`https://llun.test/api/v1/media/${id}/albums`, {
      method: 'GET'
    }),
    { params: Promise.resolve({ id }) }
  )

const allowsMethod = (response: Response, method: string) =>
  expect(response.headers.get('Access-Control-Allow-Methods')).toContain(method)

describe('/api/v1/media/[id]/albums', () => {
  const { database, prepare } = getTestDatabaseWithInstance()
  let ids: Record<string, string> = {}
  let unpostedId = ''
  // Albums a test made: removed after it, so no test sees another's.
  const made: string[] = []

  const createAlbum = async (
    title: string,
    options: { visibility?: 'public' | 'private'; mediaIds?: string[] } = {}
  ) => {
    const created = await database.createGalleryAlbumWithinLimit({
      actorId: ACTOR1_ID,
      title,
      visibility: options.visibility,
      mediaIds: options.mediaIds,
      limit: 200,
      itemLimit: 2000
    })
    if (created.status !== 'created') throw new Error('not created')
    made.push(created.album.id)
    return created.album.id
  }

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    ids = await seedGalleryRouteFixtures(database)
    // An upload nobody has posted yet: the owner's, but outside every gallery.
    const unposted = await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: '/test/unposted.jpg',
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 100, height: 100 }
      },
      details: { inGallery: true }
    })
    unpostedId = unposted!.id
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    signIn(seedActor1.email)
  })

  afterEach(async () => {
    for (const id of made.splice(0)) {
      await database.deleteGalleryAlbum({ id, actorId: ACTOR1_ID })
    }
  })

  it('advertises GET and OPTIONS', async () => {
    const response = await OPTIONS(
      new NextRequest('https://llun.test/api/v1/media/1/albums', {
        method: 'OPTIONS'
      })
    )

    allowsMethod(response, 'GET')
    allowsMethod(response, 'OPTIONS')
  })

  it('answers 401 with CORS headers without a session', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await get(ids.kingfisher)

    expect(response.status).toBe(401)
    allowsMethod(response, 'GET')
  })

  it('lists every album of the owner and marks the ones holding the photo', async () => {
    const holding = await createAlbum('Holds it', {
      mediaIds: [ids.kingfisher]
    })
    const privateHolding = await createAlbum('Holds it privately', {
      visibility: 'private',
      mediaIds: [ids.kingfisher, ids.fox]
    })
    const empty = await createAlbum('Does not')

    const response = await get(ids.kingfisher)

    expect(response.status).toBe(200)
    allowsMethod(response, 'GET')
    const body = await response.json()
    expect([...body.albumIds].sort()).toEqual([holding, privateHolding].sort())
    expect(body.addable).toBe(true)
    const byId = Object.fromEntries(
      body.albums.map((album: { id: string }) => [album.id, album])
    )
    expect(byId[holding]).toEqual({
      id: holding,
      title: 'Holds it',
      visibility: 'public',
      itemCount: 1
    })
    expect(byId[privateHolding]).toMatchObject({
      visibility: 'private',
      itemCount: 2
    })
    expect(byId[empty]).toMatchObject({ title: 'Does not', itemCount: 0 })
    // Nothing else of the album leaks into the menu's data.
    expect(Object.keys(byId[empty]).sort()).toEqual([
      'id',
      'itemCount',
      'title',
      'visibility'
    ])
  })

  it('reports no album for a photo that is in none', async () => {
    const body = await (await get(ids.lakes)).json()

    expect(body.albumIds).toEqual([])
    expect(body.addable).toBe(true)
  })

  it('marks a photo that is not posted as not addable', async () => {
    const response = await get(unpostedId)

    expect(response.status).toBe(200)
    expect((await response.json()).addable).toBe(false)
  })

  describe('media that is not the caller', () => {
    it('answers the same 404 for another account media and for a missing id', async () => {
      await createAlbum('Mine only', { mediaIds: [ids.kingfisher] })
      signIn(seedActor2.email)

      const foreign = await get(ids.kingfisher)
      const missing = await get('999999')
      const malformed = await get('not-a-number')

      expect(foreign.status).toBe(404)
      expect(missing.status).toBe(404)
      expect(malformed.status).toBe(404)
      const body = await missing.json()
      expect(body).toEqual({ error: expect.any(String) })
      expect(await foreign.json()).toEqual(body)
      expect(await malformed.json()).toEqual(body)
      allowsMethod(foreign, 'GET')
    })

    it('never shows the owner albums to another account', async () => {
      signIn(seedActor2.email)

      const text = await (await get(ids.kingfisher)).text()

      expect(text).not.toContain('Mine only')
    })
  })
})
