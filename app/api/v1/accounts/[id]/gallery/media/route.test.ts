import { NextRequest } from 'next/server'

import { toEpochMilliseconds } from '@/lib/database/kysely/normalize'
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
  const { database, db, prepare } = getTestDatabaseWithInstance()
  let ids: Record<string, string> = {}

  const ensureSortAt = async () => {
    const rows = await db
      .selectFrom('medias')
      .select(['id', 'takenAt', 'createdAt', 'updatedAt'])
      .where('sortAt', 'is', null)
      .execute()
    for (const row of rows) {
      const ms =
        [row.takenAt, row.createdAt, row.updatedAt]
          .map(toEpochMilliseconds)
          .find((value) => value !== null && !Number.isNaN(value)) ?? 0
      await db
        .updateTable('medias')
        .set({ sortAt: new Date(ms) })
        .where('id', '=', row.id)
        .execute()
    }
  }

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    ids = await seedGalleryRouteFixtures(database)
    await ensureSortAt()
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

      // Added in Gallery with no post: only the owner's list has it.
      const added = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: '/test/route-added.jpg',
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 }
        },
        details: { inGallery: false, subjectName: 'Added Egret' }
      })
      await database.addMediaToGallery({
        actorId: ACTOR1_ID,
        mediaIds: [added!.id]
      })
    })

    it.each([
      {
        description: 'is the gallery when the owner sends nothing',
        query: '',
        expected: [
          'Added Egret',
          'Grey Heron',
          'Lakes',
          'Red Fox',
          'Kingfisher'
        ]
      },
      {
        description: 'lists every posted or added photo with show=all',
        query: '?show=all',
        expected: [
          'Added Egret',
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
        expected: [
          'Added Egret',
          'Grey Heron',
          'Lakes',
          'Red Fox',
          'Kingfisher'
        ]
      },
      {
        description: 'lists only hidden photos with show=hidden',
        query: '?show=hidden',
        expected: ['Hidden Wren']
      },
      {
        description: 'lists only photos added in Gallery with show=not_posted',
        query: '?show=not_posted',
        expected: ['Added Egret']
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
      ).toEqual([true, false, true, true, true, true])
    })

    it('marks the owner photos no post uses, without a status', async () => {
      signIn(seedActor1.email)

      const { items } = await (await call(ACTOR1_ID, '?show=all')).json()

      expect(
        items.map((item: { posted: boolean; statusId: string | null }) => [
          item.posted,
          item.statusId === null
        ])
      ).toEqual([
        [false, true],
        [true, false],
        [true, false],
        [true, false],
        [true, false],
        [true, false]
      ])
      expect(items[0].attachment).toMatchObject({
        mediaType: 'image/jpeg',
        url: expect.stringContaining('/api/v1/files//test/route-added.jpg')
      })
    })

    it.each([
      ['a logged-out caller', null],
      ['a stranger', seedActor2.email],
      ['a follower', seedActor3.email]
    ])('is ignored for %s', async (_, email) => {
      signIn(email)
      const baseline = await (await call(ACTOR1_ID)).json()

      for (const show of [
        'all',
        'hidden',
        'in_gallery',
        'not_posted',
        'not_in_album'
      ]) {
        const body = await (await call(ACTOR1_ID, `?show=${show}`)).json()
        expect(body).toEqual(baseline)
        const shown = body.items.map(
          (item: { subject: { name: string } | null }) => item.subject?.name
        )
        expect(shown).not.toContain('Hidden Wren')
        expect(shown).not.toContain('Added Egret')
        for (const item of body.items) {
          expect(item).not.toHaveProperty('inGallery')
          expect(item).not.toHaveProperty('posted')
        }
      }
    })

    it('accepts show=not_in_album with 200 for the owner', async () => {
      const album = await database.createGalleryAlbumWithinLimit({
        actorId: ACTOR1_ID,
        title: 'Owner Album',
        mediaIds: [ids.kingfisher],
        limit: 100
      })
      if (album.status !== 'created') throw new Error('album not created')

      try {
        signIn(seedActor1.email)

        const response = await call(ACTOR1_ID, '?show=not_in_album')

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(Array.isArray(body.items)).toBe(true)
        const shown = body.items.map(
          (item: { subject: { name: string } | null }) => item.subject?.name
        )
        expect(shown).not.toContain('Kingfisher')
        expect(shown).toContain('Red Fox')

        signIn(null)
        const visitorResponse = await call(ACTOR1_ID, '?show=not_in_album')
        expect(visitorResponse.status).toBe(200)
        const visitorBody = await visitorResponse.json()
        const visitorBaseline = await (await call(ACTOR1_ID)).json()
        expect(visitorBody).toEqual(visitorBaseline)
        const visitorShown = visitorBody.items.map(
          (item: { subject: { name: string } | null }) => item.subject?.name
        )
        expect(visitorShown).toContain('Kingfisher')
        expect(visitorShown).toContain('Red Fox')
      } finally {
        await database.deleteGalleryAlbum({
          id: album.album.id,
          actorId: ACTOR1_ID
        })
      }
    })

    it('provides numeric albumCount on owner items and omits it for visitor items', async () => {
      signIn(seedActor1.email)
      const ownerBody = await (await call(ACTOR1_ID)).json()
      expect(ownerBody.items.length).toBeGreaterThan(0)
      for (const item of ownerBody.items) {
        expect(typeof item.albumCount).toBe('number')
      }

      signIn(null)
      const visitorBody = await (await call(ACTOR1_ID)).json()
      expect(visitorBody.items.length).toBeGreaterThan(0)
      for (const item of visitorBody.items) {
        expect(item).not.toHaveProperty('albumCount')
      }
    })

    it('answers 422 for an unknown value', async () => {
      signIn(seedActor1.email)

      const response = await call(ACTOR1_ID, '?show=everything')

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: 'Unprocessable entity' })
    })
  })

  describe('owner sorting and pagination', () => {
    beforeAll(async () => {
      await ensureSortAt()
    })

    it('orders by sort=taken_desc, sort=taken_asc, and sort=uploaded', async () => {
      signIn(seedActor1.email)

      const desc = await call(ACTOR1_ID, '?sort=taken_desc&include_total=true')
      expect(desc.status).toBe(200)
      const descBody = await desc.json()
      expect(
        descBody.items.map(
          (i: { subject: { name: string } | null }) => i.subject?.name
        )
      ).toEqual(['Added Egret', 'Grey Heron', 'Kingfisher', 'Red Fox', 'Lakes'])
      expect(descBody.total).toBe(5)
      expect(descBody.nextCursor).toBeNull()

      const asc = await call(ACTOR1_ID, '?sort=taken_asc&include_total=true')
      expect(asc.status).toBe(200)
      const ascBody = await asc.json()
      expect(
        ascBody.items.map(
          (i: { subject: { name: string } | null }) => i.subject?.name
        )
      ).toEqual(['Lakes', 'Red Fox', 'Kingfisher', 'Grey Heron', 'Added Egret'])
      expect(ascBody.total).toBe(5)
      expect(ascBody.nextCursor).toBeNull()

      const uploaded = await call(
        ACTOR1_ID,
        '?sort=uploaded&include_total=true'
      )
      expect(uploaded.status).toBe(200)
      const uploadedBody = await uploaded.json()
      expect(
        uploadedBody.items.map(
          (i: { subject: { name: string } | null }) => i.subject?.name
        )
      ).toEqual(['Added Egret', 'Grey Heron', 'Lakes', 'Red Fox', 'Kingfisher'])
      expect(uploadedBody.total).toBe(5)
      expect(uploadedBody.nextMaxId).toBeNull()
    })

    it('pages with cursor on date sorts', async () => {
      signIn(seedActor1.email)

      const first = await (
        await call(ACTOR1_ID, '?sort=taken_desc&limit=2&include_total=true')
      ).json()
      expect(first.items).toHaveLength(2)
      expect(
        first.items.map(
          (i: { subject: { name: string } | null }) => i.subject?.name
        )
      ).toEqual(['Added Egret', 'Grey Heron'])
      expect(first.nextCursor).toEqual(expect.any(String))
      expect(first.nextMaxId).toBeNull()
      expect(first.total).toBe(5)

      const second = await (
        await call(
          ACTOR1_ID,
          `?sort=taken_desc&limit=2&cursor=${first.nextCursor}`
        )
      ).json()
      expect(second.items).toHaveLength(2)
      expect(
        second.items.map(
          (i: { subject: { name: string } | null }) => i.subject?.name
        )
      ).toEqual(['Kingfisher', 'Red Fox'])
      expect(second.nextCursor).toEqual(expect.any(String))
      expect(second.nextMaxId).toBeNull()
      expect(second).not.toHaveProperty('total')

      const third = await (
        await call(
          ACTOR1_ID,
          `?sort=taken_desc&limit=2&cursor=${second.nextCursor}`
        )
      ).json()
      expect(third.items).toHaveLength(1)
      expect(
        third.items.map(
          (i: { subject: { name: string } | null }) => i.subject?.name
        )
      ).toEqual(['Lakes'])
      expect(third.nextCursor).toBeNull()
      expect(third.nextMaxId).toBeNull()
      expect(third).not.toHaveProperty('total')
    })
  })

  describe('owner filters', () => {
    it('filters by taken_from and taken_to', async () => {
      signIn(seedActor1.email)

      const res2023 = await call(
        ACTOR1_ID,
        '?taken_from=2023-01-01&taken_to=2023-12-31&include_total=true'
      )
      expect(res2023.status).toBe(200)
      const body2023 = await res2023.json()
      expect(
        body2023.items.map(
          (i: { subject: { name: string } | null }) => i.subject?.name
        )
      ).toEqual(['Red Fox'])
      expect(body2023.total).toBe(1)

      const res2024 = await call(
        ACTOR1_ID,
        '?taken_from=2024-01-01&taken_to=2024-12-31&include_total=true'
      )
      expect(res2024.status).toBe(200)
      const body2024 = await res2024.json()
      expect(
        body2024.items.map(
          (i: { subject: { name: string } | null }) => i.subject?.name
        )
      ).toEqual(['Grey Heron', 'Kingfisher'])
      expect(body2024.total).toBe(2)
    })

    it('filters by place', async () => {
      signIn(seedActor1.email)

      const resPlace = await call(ACTOR1_ID, '?place=River&include_total=true')
      expect(resPlace.status).toBe(200)
      const bodyPlace = await resPlace.json()
      expect(
        bodyPlace.items.map(
          (i: { subject: { name: string } | null }) => i.subject?.name
        )
      ).toEqual(['Kingfisher'])
      expect(bodyPlace.total).toBe(1)

      const resNone = await call(ACTOR1_ID, '?place=none')
      expect(resNone.status).toBe(200)
      const bodyNone = await resNone.json()
      const noneNames = bodyNone.items.map(
        (i: { subject: { name: string } | null }) => i.subject?.name
      )
      expect(noneNames).toContain('Lakes')
      expect(noneNames).toContain('Added Egret')
      expect(noneNames).not.toContain('Kingfisher')
    })

    it('filters by activity_id', async () => {
      signIn(seedActor1.email)

      const file = await database.createFitnessFile({
        actorId: ACTOR1_ID,
        path: 'fitness/route-test-activity.fit',
        fileName: 'route-test-activity.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 100
      })
      await database.updateFitnessFileProcessingStatus(file!.id, 'completed')
      await database.updateFitnessFileStatus(
        file!.id,
        `${ACTOR1_ID}/statuses/gallery-route-public`
      )

      try {
        const resAct = await call(
          ACTOR1_ID,
          `?activity_id=${file!.id}&include_total=true`
        )
        expect(resAct.status).toBe(200)
        const bodyAct = await resAct.json()
        expect(
          bodyAct.items.map(
            (i: { subject: { name: string } | null }) => i.subject?.name
          )
        ).toEqual(['Lakes', 'Red Fox', 'Kingfisher'])
        expect(bodyAct.total).toBe(3)

        const resActNone = await call(ACTOR1_ID, '?activity_id=none')
        expect(resActNone.status).toBe(200)
        const bodyActNone = await resActNone.json()
        const actNoneNames = bodyActNone.items.map(
          (i: { subject: { name: string } | null }) => i.subject?.name
        )
        expect(actNoneNames).toContain('Added Egret')
        expect(actNoneNames).toContain('Grey Heron')
        expect(actNoneNames).not.toContain('Kingfisher')
      } finally {
        await database.deleteFitnessFile({ id: file!.id })
      }
    })

    it('filters by album_id with total and inAlbumTotal', async () => {
      signIn(seedActor1.email)

      const album = await database.createGalleryAlbumWithinLimit({
        actorId: ACTOR1_ID,
        title: 'Route Test Album',
        mediaIds: [ids.kingfisher, ids.fox],
        limit: 100
      })
      if (album.status !== 'created') throw new Error('album not created')

      try {
        const resAlbum = await call(
          ACTOR1_ID,
          `?album_id=${album.album.id}&include_total=true`
        )
        expect(resAlbum.status).toBe(200)
        const bodyAlbum = await resAlbum.json()
        expect(bodyAlbum.total).toBe(5)
        expect(bodyAlbum.inAlbumTotal).toBe(2)
      } finally {
        await database.deleteGalleryAlbum({
          id: album.album.id,
          actorId: ACTOR1_ID
        })
      }
    })
  })

  describe('parameter validation', () => {
    it.each([
      ['cursor without date sort', '?cursor=1000:1'],
      ['cursor with uploaded sort', '?sort=uploaded&cursor=1000:1']
    ])('answers 422 for %s', async (_, query) => {
      signIn(seedActor1.email)

      const response = await call(ACTOR1_ID, query)
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({
        error: 'cursor is only supported for date sorts'
      })
    })

    it('answers 422 for max_id with date sort', async () => {
      signIn(seedActor1.email)

      const response = await call(ACTOR1_ID, '?sort=taken_desc&max_id=123')
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({
        error: 'max_id cannot be used with date sort'
      })
    })

    it('answers 422 for invalid cursor string', async () => {
      signIn(seedActor1.email)

      const response = await call(
        ACTOR1_ID,
        '?sort=taken_desc&cursor=not-a-cursor'
      )
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({
        error: 'Invalid cursor'
      })
    })

    it('answers 422 for a cursor media id beyond the integer range', async () => {
      signIn(seedActor1.email)

      const response = await call(
        ACTOR1_ID,
        '?sort=taken_desc&cursor=1704067200000:9999999999'
      )
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: 'Invalid cursor' })
    })

    it('keeps place=none for "no place": a place named "none" is not reachable by name', async () => {
      signIn(seedActor1.email)
      const fox = await db
        .selectFrom('medias')
        .select(['id', 'placeName'])
        .where('subjectName', '=', 'Red Fox')
        .where('actorId', '=', ACTOR1_ID)
        .executeTakeFirstOrThrow()
      await db
        .updateTable('medias')
        .set({ placeName: 'none' })
        .where('id', '=', fox.id)
        .execute()

      try {
        const response = await call(ACTOR1_ID, '?place=none')
        expect(response.status).toBe(200)
        const noneNames = await names(response)
        expect(noneNames).toContain('Lakes')
        expect(noneNames).not.toContain('Red Fox')
      } finally {
        await db
          .updateTable('medias')
          .set({ placeName: fox.placeName })
          .where('id', '=', fox.id)
          .execute()
      }
    })

    it('answers 422 for a cursor key beyond the range of a Date', async () => {
      signIn(seedActor1.email)

      const response = await call(
        ACTOR1_ID,
        '?sort=taken_desc&cursor=9000000000000000:1'
      )
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: 'Invalid cursor' })
    })

    it('leaves total out unless include_total=true', async () => {
      signIn(seedActor1.email)

      const without = await (await call(ACTOR1_ID)).json()
      expect(without).not.toHaveProperty('total')

      const withTotal = await (
        await call(ACTOR1_ID, '?include_total=true')
      ).json()
      expect(withTotal.total).toBe(5)
    })

    it.each([
      ['an impossible calendar date', '?taken_from=2025-02-31', 'taken_from'],
      ['a malformed date', '?taken_to=bad-date', 'taken_to']
    ])('answers 422 for %s', async (_, query, param) => {
      signIn(seedActor1.email)

      const response = await call(ACTOR1_ID, query)
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({
        error: `Invalid ${param} date`
      })
    })

    it('answers 422 when taken_from is after taken_to', async () => {
      signIn(seedActor1.email)

      const response = await call(
        ACTOR1_ID,
        '?taken_from=2025-10-10&taken_to=2025-10-01'
      )
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({
        error: 'taken_from cannot be after taken_to'
      })
    })
  })

  describe('non-owner callers', () => {
    it.each([
      ['a logged-out caller', null],
      ['a stranger', seedActor2.email],
      ['a follower', seedActor3.email]
    ])('drops owner-only params for %s', async (_, email) => {
      signIn(email)
      const baseline = await (await call(ACTOR1_ID)).json()

      const response = await call(
        ACTOR1_ID,
        '?sort=taken_desc&cursor=1000:1&place=Somewhere&taken_from=2025-01-01&taken_to=2025-12-31&activity_id=act-1&album_id=alb-1'
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toEqual(baseline)
      expect(body).not.toHaveProperty('total')
      expect(body).not.toHaveProperty('nextCursor')
      expect(body).not.toHaveProperty('inAlbumTotal')
    })

    it.each([
      ['a logged-out caller', null],
      ['a stranger', seedActor2.email]
    ])(
      'ignores malformed owner-only params for %s instead of rejecting them',
      async (_, email) => {
        signIn(email)
        const baseline = await (await call(ACTOR1_ID)).json()

        const response = await call(
          ACTOR1_ID,
          `?sort=bogus&place=&activity_id=&album_id=&taken_from=nope&include_total=maybe&cursor=${'9'.repeat(60)}`
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(baseline)
      }
    )

    it('still answers 422 to gear_id from a non-owner', async () => {
      signIn(null)

      expect((await call(ACTOR1_ID, '?gear_id=x')).status).toBe(422)
    })
  })

  describe('day stats and day ids', () => {
    // 61 photos on the kingfisher's day (62 matches with it), so limit=61
    // tells the page cap of 60 from the ids read's cap.
    const bulkDay = new Date(Date.UTC(2024, 2, 1, 12, 0, 0))
    let bulkIds: string[] = []
    let bulkDatelessId = ''

    beforeAll(async () => {
      for (let index = 0; index < 61; index += 1) {
        const row = await db
          .insertInto('medias')
          .values({
            actorId: ACTOR1_ID,
            original: `medias/ids-only-bulk-${index}.jpg`,
            originalBytes: 1000,
            originalMimeType: 'image/jpeg',
            originalMetaData: JSON.stringify({ width: 100, height: 100 }),
            inGallery: true,
            galleryAddedAt: new Date(1000),
            createdAt: bulkDay,
            updatedAt: bulkDay,
            sortAt: bulkDay,
            takenAt: bulkDay
          })
          .returning('id')
          .executeTakeFirstOrThrow()
        bulkIds.push(String(row.id))
      }

      const datelessRow = await db
        .insertInto('medias')
        .values({
          actorId: ACTOR1_ID,
          original: 'medias/ids-only-bulk-dateless.jpg',
          originalBytes: 1000,
          originalMimeType: 'image/jpeg',
          originalMetaData: JSON.stringify({ width: 100, height: 100 }),
          inGallery: true,
          galleryAddedAt: new Date(1000),
          createdAt: bulkDay,
          updatedAt: bulkDay,
          sortAt: bulkDay,
          takenAt: null
        })
        .returning('id')
        .executeTakeFirstOrThrow()
      bulkDatelessId = String(datelessRow.id)
    })

    afterAll(async () => {
      await db
        .deleteFrom('medias')
        .where('original', 'like', 'medias/ids-only-bulk-%')
        .execute()
    })

    it('gives the owner the days the page spans with include_days=true', async () => {
      signIn(seedActor1.email)

      const body = await (
        await call(ACTOR1_ID, '?sort=taken_desc&include_days=true')
      ).json()

      // The page holds 24 rows; the day's count is the full-day number.
      expect(body.items).toHaveLength(24)
      expect(body.days['2024-03-01']).toEqual({
        count: 62,
        placeName: 'River',
        activity: null
      })
      expect(body.days['2024-05-01']).toEqual({
        count: 1,
        placeName: null,
        activity: null
      })
      // The dateless addition shares the day of its upload; the days the page
      // does not span are absent.
      const uploadedKeys = Object.keys(body.days).filter((key) =>
        key.startsWith('uploaded:')
      )
      expect(uploadedKeys).toHaveLength(2)
      expect(body.days['uploaded:2024-03-01'].count).toBe(1)
      expect(uploadedKeys.every((key) => body.days[key].count === 1)).toBe(true)
      expect(Object.keys(body.days)).not.toContain('2023-06-01')
      expect(Object.keys(body.days)).not.toContain('2022-01-01')
    })

    it.each([
      ['a follower', seedActor3.email],
      ['a logged-out caller', null]
    ])('ignores include_days for %s', async (_, email) => {
      signIn(email)
      const baseline = await (await call(ACTOR1_ID)).json()

      const body = await (
        await call(ACTOR1_ID, '?sort=taken_desc&include_days=true')
      ).json()

      expect(body).toEqual(baseline)
      expect(body).not.toHaveProperty('days')
    })

    it.each([
      ['a follower', seedActor3.email],
      ['a logged-out caller', null]
    ])('strips day_key from a normal read for %s', async (_, email) => {
      signIn(email)
      const baseline = await (await call(ACTOR1_ID, '?limit=2')).json()

      const body = await (
        await call(ACTOR1_ID, '?limit=2&sort=taken_desc&day_key=not-a-day')
      ).json()

      expect(body).toEqual(baseline)
    })

    it.each([
      ['a follower', seedActor3.email],
      ['a logged-out caller', null]
    ])('answers 422 to ids_only from %s', async (_, email) => {
      signIn(email)

      const response = await call(
        ACTOR1_ID,
        '?ids_only=true&day_key=2024-03-01&offset=1'
      )

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({
        error: 'ids_only is only available to the owner'
      })

      // The offset bound cannot soften it: ids_only is rejected before
      // the params are even validated.
      const beyond = await call(
        ACTOR1_ID,
        '?ids_only=true&day_key=2024-03-01&offset=100001'
      )

      expect(beyond.status).toBe(422)
      expect(await beyond.json()).toEqual({
        error: 'ids_only is only available to the owner'
      })
    })

    it('answers the day ids for the owner, honouring limit past the page cap', async () => {
      signIn(seedActor1.email)

      const limited = await (
        await call(
          ACTOR1_ID,
          '?ids_only=true&day_key=2024-03-01&sort=taken_asc&limit=61'
        )
      ).json()
      expect(limited.mediaIds).toEqual([
        ids.kingfisher,
        ...bulkIds.slice(0, 60)
      ])

      const all = await (
        await call(
          ACTOR1_ID,
          '?ids_only=true&day_key=2024-03-01&sort=taken_asc'
        )
      ).json()
      expect(all.mediaIds).toEqual([ids.kingfisher, ...bulkIds])

      const offsetPage = await (
        await call(
          ACTOR1_ID,
          '?ids_only=true&day_key=2024-03-01&sort=taken_asc&limit=2&offset=1'
        )
      ).json()
      expect(offsetPage.mediaIds).toEqual(bulkIds.slice(0, 2))

      // The uploaded: key under sort=uploaded reads the createdAt day.
      const uploaded = await (
        await call(
          ACTOR1_ID,
          '?ids_only=true&sort=uploaded&day_key=uploaded:2024-03-01'
        )
      ).json()
      expect(uploaded.mediaIds).toEqual([
        bulkDatelessId,
        ...[...bulkIds].reverse()
      ])
    })

    it('pages normal owner reads within dated, dateless-uploaded, and upload days', async () => {
      signIn(seedActor1.email)

      const datedFirst = await (
        await call(ACTOR1_ID, '?sort=taken_asc&day_key=2024-03-01&limit=60')
      ).json()
      expect(
        datedFirst.items.map((item: { mediaId: string }) => item.mediaId)
      ).toEqual([ids.kingfisher, ...bulkIds.slice(0, 59)])
      expect(datedFirst.nextCursor).toEqual(expect.any(String))

      const datedSecond = await (
        await call(
          ACTOR1_ID,
          `?sort=taken_asc&day_key=2024-03-01&limit=60&cursor=${datedFirst.nextCursor}`
        )
      ).json()
      expect(
        datedSecond.items.map((item: { mediaId: string }) => item.mediaId)
      ).toEqual(bulkIds.slice(59))
      expect(datedSecond.nextCursor).toBeNull()

      const dateless = await (
        await call(ACTOR1_ID, '?sort=taken_desc&day_key=uploaded:2024-03-01')
      ).json()
      expect(
        dateless.items.map((item: { mediaId: string }) => item.mediaId)
      ).toEqual([bulkDatelessId])

      const uploadedFirst = await (
        await call(
          ACTOR1_ID,
          '?sort=uploaded&day_key=uploaded:2024-03-01&limit=60'
        )
      ).json()
      expect(
        uploadedFirst.items.map((item: { mediaId: string }) => item.mediaId)
      ).toEqual([bulkDatelessId, ...bulkIds.slice().reverse().slice(0, 59)])
      expect(uploadedFirst.nextMaxId).toEqual(expect.any(String))

      const uploadedSecond = await (
        await call(
          ACTOR1_ID,
          `?sort=uploaded&day_key=uploaded:2024-03-01&limit=60&max_id=${uploadedFirst.nextMaxId}`
        )
      ).json()
      expect(
        uploadedSecond.items.map((item: { mediaId: string }) => item.mediaId)
      ).toEqual(bulkIds.slice().reverse().slice(59))
      expect(uploadedSecond.nextMaxId).toBeNull()
    })

    it('leaves the album members out of the day ids', async () => {
      const album = await database.createGalleryAlbumWithinLimit({
        actorId: ACTOR1_ID,
        title: 'Ids exclusion album',
        mediaIds: [ids.kingfisher],
        limit: 100
      })
      if (album.status !== 'created') throw new Error('album not created')

      try {
        signIn(seedActor1.email)

        const body = await (
          await call(
            ACTOR1_ID,
            `?ids_only=true&day_key=2024-03-01&sort=taken_asc&album_id=${album.album.id}`
          )
        ).json()

        expect(body.mediaIds).toEqual(bulkIds)
      } finally {
        await database.deleteGalleryAlbum({
          id: album.album.id,
          actorId: ACTOR1_ID
        })
      }
    })

    it.each([
      [
        'ids_only without day_key',
        '?ids_only=true',
        'day_key is required with ids_only'
      ],
      [
        'ids_only with an unparsable day_key',
        '?ids_only=true&day_key=not-a-day',
        'Invalid day_key'
      ],
      [
        'ids_only with an impossible calendar date',
        '?ids_only=true&day_key=2025-02-30',
        'Invalid day_key'
      ],
      [
        'a plain day_key under sort=uploaded',
        '?ids_only=true&sort=uploaded&day_key=2025-10-04',
        'day_key does not match sort'
      ],
      [
        'a plain day_key with the sort defaulted to uploaded',
        '?ids_only=true&day_key=2025-10-04',
        'day_key does not match sort'
      ],
      [
        'a normal list with a plain day_key under sort=uploaded',
        '?sort=uploaded&day_key=2025-10-04',
        'day_key does not match sort'
      ],
      [
        'a normal list with a plain day_key and default sort',
        '?day_key=2025-10-04',
        'day_key does not match sort'
      ],
      [
        'a normal list with an invalid day_key',
        '?sort=taken_desc&day_key=not-a-day',
        'Invalid day_key'
      ],
      [
        'ids_only with an invalid taken_from',
        '?ids_only=true&day_key=2024-03-01&sort=taken_asc&taken_from=not-a-date',
        'Invalid taken_from date'
      ],
      [
        'ids_only with an invalid taken_to',
        '?ids_only=true&day_key=2024-03-01&sort=taken_asc&taken_to=not-a-date',
        'Invalid taken_to date'
      ],
      [
        'ids_only with a cursor',
        '?ids_only=true&day_key=2024-03-01&sort=taken_desc&cursor=1000:1',
        'ids_only takes no cursor'
      ],
      [
        'ids_only with max_id',
        '?ids_only=true&day_key=2024-03-01&sort=taken_desc&max_id=123',
        'ids_only takes no cursor'
      ]
    ])('answers 422 for %s', async (_, query, error) => {
      signIn(seedActor1.email)

      const response = await call(ACTOR1_ID, query)

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error })
    })

    it.each([
      ['a negative offset', 'offset=-1'],
      ['a non-integer offset', 'offset=1.5'],
      ['a non-numeric offset', 'offset=invalid'],
      ['an offset past the cap', 'offset=100001']
    ])('answers 422 for %s on ids_only', async (_, offset) => {
      signIn(seedActor1.email)

      const response = await call(
        ACTOR1_ID,
        `?ids_only=true&day_key=2024-03-01&sort=taken_asc&${offset}`
      )

      expect(response.status).toBe(422)
    })

    describe('a dateless upload whose sortAt day differs from its upload day', () => {
      // A dateless upload is stamped sortAt just before createdAt, so it can
      // sort at the very end of one UTC day while its upload day is the next.
      // These are the suite's newest photos, so taken_desc pages them first.
      const straddleSortAt = new Date(Date.UTC(2099, 9, 3, 23, 59, 59, 900))
      const straddleCreatedAt = new Date(Date.UTC(2099, 9, 4, 0, 0, 0, 100))
      const uploadNoon = new Date(Date.UTC(2099, 9, 4, 12, 0, 0))
      const datedSortAt = new Date(Date.UTC(2099, 9, 3, 12, 0, 0))
      let straddleId = ''

      const seed = async (
        name: string,
        values: { sortAt: Date; createdAt: Date; takenAt?: Date }
      ) => {
        const row = await db
          .insertInto('medias')
          .values({
            actorId: ACTOR1_ID,
            original: `medias/day-stats-straddle-${name}.jpg`,
            originalBytes: 1000,
            originalMimeType: 'image/jpeg',
            originalMetaData: JSON.stringify({ width: 100, height: 100 }),
            inGallery: true,
            galleryAddedAt: new Date(1000),
            createdAt: values.createdAt,
            updatedAt: values.createdAt,
            sortAt: values.sortAt,
            takenAt: values.takenAt ?? null
          })
          .returning('id')
          .executeTakeFirstOrThrow()
        return String(row.id)
      }

      beforeAll(async () => {
        straddleId = await seed('midnight', {
          sortAt: straddleSortAt,
          createdAt: straddleCreatedAt
        })
        await seed('upload-a', { sortAt: uploadNoon, createdAt: uploadNoon })
        await seed('upload-b', { sortAt: uploadNoon, createdAt: uploadNoon })
        // A dated photo inside the widened stats window, but not on the page.
        await seed('dated', {
          sortAt: datedSortAt,
          createdAt: datedSortAt,
          takenAt: datedSortAt
        })
      })

      afterAll(async () => {
        await db
          .deleteFrom('medias')
          .where('original', 'like', 'medias/day-stats-straddle-%')
          .execute()
      })

      it('counts the whole upload day on a page that holds only the straddling row', async () => {
        signIn(seedActor1.email)

        // The two plain 4 Oct uploads sort first; the next page holds only
        // the row whose sortAt is on 3 Oct.
        const first = await (
          await call(ACTOR1_ID, '?sort=taken_desc&include_days=true&limit=2')
        ).json()
        expect(first.items).toHaveLength(2)

        const second = await (
          await call(
            ACTOR1_ID,
            `?sort=taken_desc&include_days=true&limit=1&cursor=${first.nextCursor}`
          )
        ).json()
        expect(
          second.items.map((item: { mediaId: string }) => item.mediaId)
        ).toEqual([straddleId])

        // The page spans only 3 Oct by sortAt, but its one row groups under
        // 4 Oct's upload day: that day counts every 4 Oct dateless upload,
        // and no other day is returned.
        expect(second.days).toEqual({
          'uploaded:2099-10-04': { count: 3, placeName: null, activity: null }
        })
      })
    })
  })
})
