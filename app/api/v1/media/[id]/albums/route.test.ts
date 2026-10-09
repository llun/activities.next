import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedGalleryRouteFixtures } from '@/lib/services/gallery/galleryRouteFixtures'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

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

  // Photos a test made, with their posts: removed after it.
  const madeStatuses: string[] = []

  const makePhoto = async ({
    name,
    actorId = ACTOR1_ID,
    inGallery = true
  }: {
    name: string
    actorId?: string
    inGallery?: boolean
  }) => {
    const media = await database.createMedia({
      actorId,
      original: {
        path: `/test/albums-route-${name}.jpg`,
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 100, height: 100 }
      },
      details: { inGallery }
    })
    const statusId = `${actorId}/statuses/albums-route-${name}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: name
    })
    madeStatuses.push(statusId)
    await database.createAttachment({
      actorId,
      statusId,
      mediaType: 'image/jpeg',
      url: `https://media.test/albums-route-${name}.jpg`,
      width: 100,
      height: 100,
      mediaId: media!.id
    })
    return { mediaId: media!.id, statusId }
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
    vi.restoreAllMocks()
    for (const id of made.splice(0)) {
      await database.deleteGalleryAlbum({ id, actorId: ACTOR1_ID })
    }
    for (const statusId of madeStatuses.splice(0)) {
      await database.deleteStatus({ statusId })
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

  it('marks a photo kept out of the gallery as not addable', async () => {
    const { mediaId } = await makePhoto({
      name: 'not-in-gallery',
      inGallery: false
    })

    const response = await get(mediaId)

    expect(response.status).toBe(200)
    expect((await response.json()).addable).toBe(false)
  })

  it('marks a photo whose post was deleted as not addable, but still lists its albums', async () => {
    const { mediaId, statusId } = await makePhoto({ name: 'post-deleted' })
    const holding = await createAlbum('Kept after delete', {
      mediaIds: [mediaId]
    })
    await database.deleteStatus({ statusId })

    const response = await get(mediaId)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.addable).toBe(false)
    // The menu can still take the photo out of the album that holds it.
    expect(body.albumIds).toEqual([holding])
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

    it('never reads the owner’s albums for a request it refuses', async () => {
      await createAlbum('Mine only', { mediaIds: [ids.kingfisher] })
      const summaries = vi.spyOn(database, 'getGalleryAlbumSummaries')
      const holding = vi.spyOn(database, 'getAlbumsForMedia')
      signIn(seedActor2.email)

      const foreign = await get(ids.kingfisher)
      const missing = await get('999999')
      const malformed = await get('not-a-number')

      expect([foreign.status, missing.status, malformed.status]).toEqual([
        404, 404, 404
      ])
      // The 404 is decided before any album is looked up.
      expect(summaries).not.toHaveBeenCalled()
      expect(holding).not.toHaveBeenCalled()
    })

    describe('another actor of the same account', () => {
      let siblingMediaId = ''

      beforeAll(async () => {
        const actor1 = await database.getActorFromId({ id: ACTOR1_ID })
        const siblingId = await database.createActorForAccount({
          accountId: actor1!.account!.id,
          username: 'albums-route-sibling',
          domain: 'llun.test',
          privateKey: 'privateKey-albums-route-sibling',
          publicKey: 'publicKey-albums-route-sibling'
        })
        const photo = await makePhoto({
          name: 'sibling',
          actorId: siblingId
        })
        siblingMediaId = photo.mediaId
        // The post and photo stay for the tests below (afterEach would drop
        // the post), so they are kept out of the per-test cleanup.
        madeStatuses.splice(0)
      })

      it('answers the same 404 as for a missing id, though the account owns the photo', async () => {
        // The account-level lookup finds it: only the actor check refuses.
        const lookup = await database.getMediaByIdForAccount({
          mediaId: siblingMediaId,
          accountId: (await database.getActorFromId({ id: ACTOR1_ID }))!
            .account!.id
        })
        expect(lookup?.actorId).not.toBe(ACTOR1_ID)

        const sibling = await get(siblingMediaId)
        const missing = await get('999999')

        expect(sibling.status).toBe(404)
        expect(await sibling.json()).toEqual(await missing.json())
        allowsMethod(sibling, 'GET')
      })

      it('does not read the owner’s albums for it', async () => {
        await createAlbum('Primary only')
        const summaries = vi.spyOn(database, 'getGalleryAlbumSummaries')

        await get(siblingMediaId)

        expect(summaries).not.toHaveBeenCalled()
      })
    })
  })
})
