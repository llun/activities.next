import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { MAX_GALLERY_GEAR_PER_ACTOR } from '@/lib/services/gallery/galleryRequests'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID, seedActor3 } from '@/lib/stub/seed/actor3'

import { GET, POST } from './route'

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
  cookies: vi.fn().mockResolvedValue({ get: () => undefined })
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    secretPhase: 'test-secret',
    allowEmails: [],
    allowActorDomains: []
  })
}))

describe('/api/v1/gallery/gears', () => {
  const { database, prepare } = getTestDatabaseWithInstance()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const getRequest = () =>
    new NextRequest('https://llun.test/api/v1/gallery/gears', {
      method: 'GET'
    })

  const postRequest = (body: unknown, raw = false) =>
    new NextRequest('https://llun.test/api/v1/gallery/gears', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://llun.test'
      },
      body: raw ? (body as string) : JSON.stringify(body)
    })

  describe('POST', () => {
    it('creates a camera for the signed-in actor', async () => {
      const response = await POST(
        postRequest({
          kind: 'camera',
          name: 'Canon EOS R5',
          brand: 'Canon',
          model: 'EOS R5',
          productUrl: 'https://canon.test/r5'
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      const { gear } = await response.json()
      expect(gear).toMatchObject({
        kind: 'camera',
        name: 'Canon EOS R5',
        brand: 'Canon',
        model: 'EOS R5',
        productUrl: 'https://canon.test/r5',
        retiredAt: null
      })
      expect(
        await database.getGalleryGear({ id: gear.id, actorId: ACTOR1_ID })
      ).not.toBeNull()
    })

    it('treats blank optional fields as absent', async () => {
      const response = await POST(
        postRequest({ kind: 'lens', name: '  RF 50mm  ', brand: '  ' }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      expect((await response.json()).gear).toMatchObject({
        name: 'RF 50mm',
        brand: null,
        model: null,
        productUrl: null
      })
    })

    it('returns the existing row for the same kind and a case-insensitive trimmed name', async () => {
      const first = await POST(
        postRequest({ kind: 'camera', name: 'Sony A7 IV' }),
        { params: Promise.resolve({}) }
      )
      const { gear } = await first.json()

      const again = await POST(
        postRequest({ kind: 'camera', name: '  sony   a7 iv ' }),
        { params: Promise.resolve({}) }
      )

      expect(again.status).toBe(200)
      expect((await again.json()).gear.id).toBe(gear.id)

      // A lens of the same name is a different piece of gear.
      const lens = await POST(
        postRequest({ kind: 'lens', name: 'Sony A7 IV' }),
        { params: Promise.resolve({}) }
      )
      expect((await lens.json()).gear.id).not.toBe(gear.id)
    })

    // Brings ACTOR3's gear to exactly `count` rows, adding or deleting as
    // needed, so each cap test sets up its own state and none depends on what
    // an earlier one left behind (or on running in file order at all).
    const setActor3GearCount = async (count: number) => {
      const existing = await database.getGalleryGearsByActor({
        actorId: ACTOR3_ID
      })
      for (const gear of existing.slice(count)) {
        await database.deleteGalleryGear({ id: gear.id, actorId: ACTOR3_ID })
      }
      for (let index = existing.length; index < count; index += 1) {
        await database.createGalleryGear({
          actorId: ACTOR3_ID,
          kind: 'camera',
          name: `Camera ${index}`
        })
      }
    }

    // Concurrency: the check and the insert are one transaction serialised on
    // the actor row, so in-flight requests cannot both pass either check.
    it('adds one row for concurrent submits of the same new gear', async () => {
      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          POST(postRequest({ kind: 'lens', name: 'Concurrent 70-200mm' }), {
            params: Promise.resolve({})
          })
        )
      )

      const ids = await Promise.all(
        responses.map(async (response) => {
          expect(response.status).toBe(200)
          return (await response.json()).gear.id
        })
      )
      expect(new Set(ids).size).toBe(1)
      const gears = await database.getGalleryGearsByActor({
        actorId: ACTOR1_ID
      })
      expect(
        gears.filter((gear) => gear.name === 'Concurrent 70-200mm')
      ).toHaveLength(1)
    })

    it('does not overshoot the cap under concurrent creates', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor3.email }
      })
      await setActor3GearCount(MAX_GALLERY_GEAR_PER_ACTOR - 1)
      expect(
        await database.getGalleryGearsByActor({ actorId: ACTOR3_ID })
      ).toHaveLength(MAX_GALLERY_GEAR_PER_ACTOR - 1)

      const responses = await Promise.all(
        ['Racing A', 'Racing B', 'Racing C'].map((name) =>
          POST(postRequest({ kind: 'lens', name }), {
            params: Promise.resolve({})
          })
        )
      )

      expect(responses.map((response) => response.status).toSorted()).toEqual([
        200, 422, 422
      ])
      expect(
        await database.getGalleryGearsByActor({ actorId: ACTOR3_ID })
      ).toHaveLength(MAX_GALLERY_GEAR_PER_ACTOR)
    })

    it('answers 422 once the actor holds the maximum number of gear items', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor3.email }
      })
      await setActor3GearCount(MAX_GALLERY_GEAR_PER_ACTOR)

      const response = await POST(
        postRequest({ kind: 'camera', name: 'One camera too many' }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: 'Too many gear items' })
      expect(
        await database.getGalleryGearsByActor({ actorId: ACTOR3_ID })
      ).toHaveLength(MAX_GALLERY_GEAR_PER_ACTOR)

      // A name already held is still handed back at the cap.
      const existing = await POST(
        postRequest({ kind: 'camera', name: 'camera 0' }),
        { params: Promise.resolve({}) }
      )
      expect(existing.status).toBe(200)
    })

    it.each([
      ['an unknown kind', { kind: 'tripod', name: 'Gitzo' }],
      ['the fitness-only kind bike', { kind: 'bike', name: 'Moots' }],
      ['a missing name', { kind: 'camera' }],
      ['a blank name', { kind: 'camera', name: '   ' }],
      ['a name over 255 characters', { kind: 'camera', name: 'x'.repeat(256) }],
      [
        'a javascript: product url',
        { kind: 'camera', name: 'A', productUrl: 'javascript:alert(1)' }
      ],
      [
        'a product url that is not a url',
        { kind: 'camera', name: 'A', productUrl: 'canon.com' }
      ],
      ['a non-object body', []]
    ])('answers 422 for %s', async (_, body) => {
      const response = await POST(postRequest(body), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: 'Unprocessable entity' })
    })

    it('answers 400 for a body that is not JSON', async () => {
      const response = await POST(postRequest('{nope', true), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Bad Request' })
    })

    it('rejects a cross-site request', async () => {
      const response = await POST(
        new NextRequest('https://llun.test/api/v1/gallery/gears', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://evil.test'
          },
          body: JSON.stringify({ kind: 'camera', name: 'A' })
        }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(403)
    })
  })

  describe('GET', () => {
    it('lists only the signed-in actor’s non-deleted gear', async () => {
      await database.createGalleryGear({
        actorId: ACTOR2_ID,
        kind: 'camera',
        name: 'Somebody else’s camera'
      })
      const mine = await database.createGalleryGear({
        actorId: ACTOR1_ID,
        kind: 'lens',
        name: 'Listed lens'
      })

      const response = await GET(getRequest(), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(200)
      const { gears } = (await response.json()) as {
        gears: { id: string; name: string }[]
      }
      expect(gears.map((gear) => gear.id)).toContain(mine.id)
      expect(gears.map((gear) => gear.name)).not.toContain(
        'Somebody else’s camera'
      )
    })

    it('adds each gear’s usage with ?include=usage', async () => {
      const used = await database.createGalleryGear({
        actorId: ACTOR1_ID,
        kind: 'camera',
        name: 'Used camera'
      })
      const unused = await database.createGalleryGear({
        actorId: ACTOR1_ID,
        kind: 'lens',
        name: 'Unused lens'
      })
      const takenAt = Date.UTC(2024, 2, 14)
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: '/test/gear-usage.jpg',
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: { width: 100, height: 100 }
        },
        details: { inGallery: true, cameraGearId: used.id, takenAt }
      })
      await database.createNote({
        id: `${ACTOR1_ID}/statuses/gear-usage`,
        url: `${ACTOR1_ID}/statuses/gear-usage`,
        actorId: ACTOR1_ID,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [],
        text: 'usage'
      })
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId: `${ACTOR1_ID}/statuses/gear-usage`,
        mediaType: 'image/jpeg',
        url: 'https://media.test/gear-usage.jpg',
        width: 100,
        height: 100,
        mediaId: media!.id
      })

      const response = await GET(
        new NextRequest('https://llun.test/api/v1/gallery/gears?include=usage'),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(200)
      const { gears } = (await response.json()) as {
        gears: { id: string; photoCount: number }[]
      }
      expect(gears.find((gear) => gear.id === used.id)).toMatchObject({
        photoCount: 1,
        firstUsedAt: takenAt,
        lastUsedAt: takenAt
      })
      expect(gears.find((gear) => gear.id === unused.id)).toMatchObject({
        photoCount: 0,
        firstUsedAt: null,
        lastUsedAt: null
      })
    })

    it('leaves the usage fields out without the option', async () => {
      const response = await GET(getRequest(), {
        params: Promise.resolve({})
      })

      const { gears } = (await response.json()) as {
        gears: Record<string, unknown>[]
      }
      expect(gears.length).toBeGreaterThan(0)
      for (const gear of gears) expect(gear).not.toHaveProperty('photoCount')
    })

    it('answers 422 for an unknown include', async () => {
      const response = await GET(
        new NextRequest('https://llun.test/api/v1/gallery/gears?include=x'),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(422)
    })

    it('redirects to sign-in without a session', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const response = await GET(getRequest(), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(307)
    })
  })
})
