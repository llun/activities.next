import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedGalleryRouteFixtures } from '@/lib/services/gallery/galleryRouteFixtures'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { seedActor3 } from '@/lib/stub/seed/actor3'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

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

const signIn = (email: string | null) =>
  mockGetServerSession.mockResolvedValue(email ? { user: { email } } : null)

const call = (accountId: string, query = '') =>
  GET(
    new NextRequest(
      `https://llun.test/api/v1/accounts/${urlToId(accountId)}/gallery/media${query}`,
      { method: 'GET' }
    ),
    { params: Promise.resolve({ id: urlToId(accountId) }) }
  )

describe('GET /api/v1/accounts/:id/gallery/media', () => {
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
    signIn(null)
  })

  it.each([
    ['a missing actor', 'https://llun.test/users/nobody'],
    ['a remote actor', EXTERNAL_ACTOR1]
  ])('answers 404 for %s', async (_, accountId) => {
    const response = await call(accountId)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not Found' })
  })

  const names = async (response: Response) =>
    (await response.json()).items.map(
      (item: { subject: { name: string } | null }) => item.subject?.name
    )

  it('lists the public photos newest upload first for a logged-out caller', async () => {
    const response = await call(ACTOR1_ID)

    expect(response.status).toBe(200)
    expect(await names(response)).toEqual(['Lakes', 'Red Fox', 'Kingfisher'])
  })

  it('adds the followers-only photo for a follower and the owner', async () => {
    signIn(seedActor3.email)
    expect(await names(await call(ACTOR1_ID))).toContain('Grey Heron')

    signIn(seedActor1.email)
    expect(await names(await call(ACTOR1_ID))).toContain('Grey Heron')
  })

  it('withholds the followers-only photo from a stranger', async () => {
    signIn(seedActor2.email)

    expect(await names(await call(ACTOR1_ID))).not.toContain('Grey Heron')
  })

  it('pages with max_id and limit', async () => {
    const first = await (await call(ACTOR1_ID, '?limit=2')).json()
    expect(first.items).toHaveLength(2)
    expect(first.nextMaxId).toEqual(expect.any(String))

    const second = await (
      await call(ACTOR1_ID, `?limit=2&max_id=${first.nextMaxId}`)
    ).json()
    expect(
      second.items.map((item: { mediaId: string }) => item.mediaId)
    ).toEqual([ids.kingfisher])
    expect(second.nextMaxId).toBeNull()
  })

  it('filters by subject key and by category', async () => {
    const bySubject = await call(ACTOR1_ID, '?subject=sci:alcedo%20atthis')
    expect(await names(bySubject)).toEqual(['Kingfisher'])

    const byCategory = await call(ACTOR1_ID, '?category=mammal')
    expect(await names(byCategory)).toEqual(['Red Fox'])
  })

  it('clamps an out-of-range limit instead of rejecting it', async () => {
    expect((await call(ACTOR1_ID, '?limit=0')).status).toBe(200)
    expect((await call(ACTOR1_ID, '?limit=9999')).status).toBe(200)
  })

  it.each([
    ['a non-numeric max_id', '?max_id=abc'],
    ['an over-long max_id', '?max_id=12345678901'],
    ['an unknown category', '?category=dinosaur'],
    ['an empty subject', '?subject='],
    ['an over-long subject', `?subject=${'a'.repeat(521)}`]
  ])('answers 422 for %s', async (_, query) => {
    const response = await call(ACTOR1_ID, query)

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'Unprocessable entity' })
  })

  it.each([
    ['a logged-out caller', null],
    ['a stranger', seedActor2.email],
    ['a follower', seedActor3.email]
  ])('answers 422 to gear_id from %s', async (_, email) => {
    signIn(email)

    const response = await call(ACTOR1_ID, '?gear_id=anything')

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: 'gear_id is only available to the owner'
    })
  })

  it('lets the owner filter by gear_id', async () => {
    signIn(seedActor1.email)

    const response = await call(ACTOR1_ID, '?gear_id=no-such-gear')

    expect(response.status).toBe(200)
    expect((await response.json()).items).toEqual([])
  })

  describe('show', () => {
    // Posted on a public post, but with Show in my gallery switched off.
    beforeAll(async () => {
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: '/test/route-hidden.jpg',
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 }
        },
        details: { inGallery: false, subjectName: 'Hidden Wren' }
      })
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId: `${ACTOR1_ID}/statuses/gallery-route-public`,
        mediaType: 'image/jpeg',
        url: 'https://media.test/route-hidden.jpg',
        width: 100,
        height: 100,
        mediaId: media!.id
      })
    })

    it.each([
      {
        description: 'is the gallery when the owner sends nothing',
        query: '',
        expected: ['Grey Heron', 'Lakes', 'Red Fox', 'Kingfisher']
      },
      {
        description: 'lists every posted photo with show=all',
        query: '?show=all',
        expected: [
          'Hidden Wren',
          'Grey Heron',
          'Lakes',
          'Red Fox',
          'Kingfisher'
        ]
      },
      {
        description: 'lists the gallery with show=in_gallery',
        query: '?show=in_gallery',
        expected: ['Grey Heron', 'Lakes', 'Red Fox', 'Kingfisher']
      },
      {
        description: 'lists only hidden photos with show=hidden',
        query: '?show=hidden',
        expected: ['Hidden Wren']
      }
    ])('for the owner $description', async ({ query, expected }) => {
      signIn(seedActor1.email)

      const response = await call(ACTOR1_ID, query)

      expect(response.status).toBe(200)
      expect(await names(response)).toEqual(expected)
    })

    it('tells the owner which photos are in the gallery', async () => {
      signIn(seedActor1.email)

      const { items } = await (await call(ACTOR1_ID, '?show=all')).json()

      expect(
        items.map((item: { inGallery: boolean }) => item.inGallery)
      ).toEqual([false, true, true, true, true])
    })

    it.each([
      ['a logged-out caller', null],
      ['a stranger', seedActor2.email],
      ['a follower', seedActor3.email]
    ])('is ignored for %s', async (_, email) => {
      signIn(email)
      const baseline = await (await call(ACTOR1_ID)).json()

      for (const show of ['all', 'hidden', 'in_gallery']) {
        const body = await (await call(ACTOR1_ID, `?show=${show}`)).json()
        expect(body).toEqual(baseline)
        expect(
          body.items.map(
            (item: { subject: { name: string } | null }) => item.subject?.name
          )
        ).not.toContain('Hidden Wren')
        for (const item of body.items) {
          expect(item).not.toHaveProperty('inGallery')
        }
      }
    })

    it('answers 422 for an unknown value', async () => {
      signIn(seedActor1.email)

      const response = await call(ACTOR1_ID, '?show=everything')

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: 'Unprocessable entity' })
    })
  })
})
