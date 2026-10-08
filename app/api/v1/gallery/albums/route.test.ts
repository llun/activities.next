import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedGalleryRouteFixtures } from '@/lib/services/gallery/galleryRouteFixtures'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { MAX_GALLERY_ALBUMS_PER_ACTOR } from '@/lib/types/database/galleryAlbums'

import { GET, POST } from './route'

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

const list = () =>
  GET(
    new NextRequest('https://llun.test/api/v1/gallery/albums', {
      method: 'GET'
    }),
    { params: Promise.resolve({}) }
  )

const create = (body: unknown) =>
  POST(
    new NextRequest('https://llun.test/api/v1/gallery/albums', {
      method: 'POST',
      headers: {
        origin: 'https://llun.test',
        'content-type': 'application/json'
      },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    }),
    { params: Promise.resolve({}) }
  )

describe('/api/v1/gallery/albums', () => {
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

  describe('POST', () => {
    it('creates a public album with defaults', async () => {
      const response = await create({ title: '  Kruger, September  ' })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({
        album: {
          title: 'Kruger, September',
          description: null,
          visibility: 'public',
          sortOrder: 'taken_desc',
          itemCount: 0,
          cover: null,
          previews: []
        },
        added: [],
        skipped: []
      })
    })

    it('creates an album with its first photos and skips ids that are not the owner own', async () => {
      const response = await create({
        title: 'Birds',
        description: 'Shot at the river',
        visibility: 'private',
        sort_order: 'taken_asc',
        media_ids: [ids.kingfisher, ids.heron, '999999']
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.album).toMatchObject({
        title: 'Birds',
        description: 'Shot at the river',
        visibility: 'private',
        sortOrder: 'taken_asc',
        itemCount: 2
      })
      expect(body.added.sort()).toEqual([ids.heron, ids.kingfisher].sort())
      expect(body.skipped).toEqual(['999999'])
    })

    it('does not add another account media', async () => {
      signIn(seedActor2.email)

      const response = await create({
        title: 'Mine now',
        media_ids: [ids.kingfisher]
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.added).toEqual([])
      expect(body.skipped).toEqual([ids.kingfisher])
      expect(body.album.itemCount).toBe(0)
    })

    it.each([
      ['no title', {}],
      ['a blank title', { title: '   ' }],
      ['a title over 120 characters', { title: 'x'.repeat(121) }],
      [
        'a description over 1000 characters',
        { title: 'T', description: 'x'.repeat(1001) }
      ],
      ['an unknown visibility', { title: 'T', visibility: 'followers' }],
      ['an unknown sort', { title: 'T', sort_order: 'random' }],
      ['an empty media_ids', { title: 'T', media_ids: [] }],
      [
        'more than 100 media ids',
        {
          title: 'T',
          media_ids: Array.from({ length: 101 }, (_, i) => `${i + 1}`)
        }
      ],
      ['a media id that is not a number', { title: 'T', media_ids: ['abc'] }],
      ['a body that is not JSON', 'not json']
    ])('answers 422 for %s and creates nothing', async (_, body) => {
      const before = (await (await list()).json()).albums.length

      const response = await create(body)

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: expect.any(String) })
      expect((await (await list()).json()).albums).toHaveLength(before)
    })

    it('answers 429 over the write limit and creates nothing', async () => {
      const before = (await (await list()).json()).albums.length
      takeMock.mockReturnValue(false)

      const response = await create({ title: 'Too fast' })

      expect(response.status).toBe(429)
      expect(await response.json()).toEqual({ error: 'Too many requests' })
      expect((await (await list()).json()).albums).toHaveLength(before)
    })

    it('answers 422 at the album cap', async () => {
      const actorId = (await database.getActorFromEmail({
        email: seedActor2.email
      }))!.id
      for (let index = 0; index < MAX_GALLERY_ALBUMS_PER_ACTOR; index += 1) {
        const result = await database.createGalleryAlbumWithinLimit({
          actorId,
          title: `Album ${index}`,
          limit: MAX_GALLERY_ALBUMS_PER_ACTOR
        })
        if (result.status === 'limit-reached') break
      }
      signIn(seedActor2.email)

      const response = await create({ title: 'One too many' })

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: 'Too many albums' })
    })
  })

  describe('GET', () => {
    it('lists only the signed-in owner albums, last updated first', async () => {
      signIn(seedActor1.email)
      const first = await (await create({ title: 'List first' })).json()
      const second = await (
        await create({ title: 'List second', media_ids: [ids.fox] })
      ).json()

      const response = await list()

      expect(response.status).toBe(200)
      const body = await response.json()
      const titles = body.albums.map((album: { title: string }) => album.title)
      expect(titles).toContain('List first')
      expect(titles.indexOf('List second')).toBeLessThan(
        titles.indexOf('List first')
      )
      expect(body.albums.map((album: { id: string }) => album.id)).toEqual(
        expect.arrayContaining([first.album.id, second.album.id])
      )
      expect(body.photoCount).toBeGreaterThan(0)
      const withPhoto = body.albums.find(
        (album: { id: string }) => album.id === second.album.id
      )
      expect(withPhoto).toMatchObject({
        itemCount: 1,
        cover: { mediaId: ids.fox },
        previews: [{ mediaId: ids.fox }]
      })
    })

    it('does not list another account albums', async () => {
      signIn(seedActor2.email)

      const body = await (await list()).json()

      expect(
        body.albums.map((album: { title: string }) => album.title)
      ).not.toContain('List first')
    })
  })
})
