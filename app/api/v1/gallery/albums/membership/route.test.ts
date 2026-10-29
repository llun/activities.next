import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedGalleryRouteFixtures } from '@/lib/services/gallery/galleryRouteFixtures'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'

import { POST } from './route'

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

const postMembership = (body?: unknown) =>
  POST(
    new NextRequest('https://llun.test/api/v1/gallery/albums/membership', {
      method: 'POST',
      headers: {
        origin: 'https://llun.test',
        'content-type': 'application/json'
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) })
    }),
    { params: Promise.resolve({}) }
  )

describe('/api/v1/gallery/albums/membership', () => {
  const { database, prepare } = getTestDatabaseWithInstance()
  let ids: Record<string, string> = {}
  let album1Id = ''
  let album2Id = ''
  let actor2MediaId = ''
  let actor2AlbumId = ''

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    ids = await seedGalleryRouteFixtures(database)
    mockDatabase = database

    // Seed albums for Actor 1
    const a1 = await database.createGalleryAlbumWithinLimit({
      actorId: ACTOR1_ID,
      title: 'Album 1',
      mediaIds: [ids.kingfisher, ids.fox],
      limit: 100,
      itemLimit: 100
    })
    if (a1.status === 'created') album1Id = a1.album.id

    const a2 = await database.createGalleryAlbumWithinLimit({
      actorId: ACTOR1_ID,
      title: 'Album 2',
      mediaIds: [ids.fox, ids.heron],
      limit: 100,
      itemLimit: 100
    })
    if (a2.status === 'created') album2Id = a2.album.id

    // Seed media and album for Actor 2
    const m2 = await database.createMedia({
      actorId: ACTOR2_ID,
      original: {
        path: '/test/route-actor2.jpg',
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 100, height: 100 }
      },
      details: { inGallery: true }
    })
    actor2MediaId = m2!.id

    const a2Actor = await database.createGalleryAlbumWithinLimit({
      actorId: ACTOR2_ID,
      title: 'Actor 2 Album',
      mediaIds: [actor2MediaId],
      limit: 100,
      itemLimit: 100
    })
    if (a2Actor.status === 'created') actor2AlbumId = a2Actor.album.id
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    signIn(seedActor1.email)
  })

  describe('POST', () => {
    it('answers 401 with CORS headers when nobody is signed in', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const response = await postMembership({ media_ids: [ids.fox] })

      expect(response.status).toBe(401)
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
        'POST'
      )
    })

    it('returns albums for media ids present in two albums', async () => {
      const response = await postMembership({ media_ids: [ids.fox] })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.albums).toEqual(
        expect.arrayContaining([
          { id: album1Id, mediaIds: [ids.fox] },
          { id: album2Id, mediaIds: [ids.fox] }
        ])
      )
      expect(body.albums).toHaveLength(2)
    })

    it('returns empty albums when media ids are in no album', async () => {
      const response = await postMembership({ media_ids: ['999999'] })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ albums: [] })
    })

    it('never returns another actor media/albums to the owner and vice versa', async () => {
      // Owner asks for actor 2's media
      const ownerResponse = await postMembership({
        media_ids: [actor2MediaId, ids.fox]
      })
      expect(ownerResponse.status).toBe(200)
      const ownerBody = await ownerResponse.json()
      expect(ownerBody.albums).toEqual(
        expect.arrayContaining([
          { id: album1Id, mediaIds: [ids.fox] },
          { id: album2Id, mediaIds: [ids.fox] }
        ])
      )
      expect(
        ownerBody.albums.some((a: { id: string }) => a.id === actor2AlbumId)
      ).toBe(false)
      expect(
        ownerBody.albums.some((a: { mediaIds: string[] }) =>
          a.mediaIds.includes(actor2MediaId)
        )
      ).toBe(false)

      // Actor 2 asks for owner's media
      signIn(seedActor2.email)
      const actor2Response = await postMembership({
        media_ids: [ids.fox, actor2MediaId]
      })
      expect(actor2Response.status).toBe(200)
      const actor2Body = await actor2Response.json()
      expect(actor2Body.albums).toEqual([
        { id: actor2AlbumId, mediaIds: [actor2MediaId] }
      ])
      expect(
        actor2Body.albums.some(
          (a: { id: string }) => a.id === album1Id || a.id === album2Id
        )
      ).toBe(false)
    })

    it.each([
      ['0 ids', { media_ids: [] }],
      [
        '101 ids',
        { media_ids: Array.from({ length: 101 }, (_, i) => String(i + 1)) }
      ],
      ['non-digit id', { media_ids: ['abc'] }],
      ['missing body', undefined],
      ['empty JSON object', {}],
      ['non-JSON body', 'not json']
    ])('answers 422 for %s', async (_, body) => {
      const response = await postMembership(body)

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: expect.any(String) })
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
        'POST'
      )
    })
  })
})
