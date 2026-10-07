import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { MAX_GALLERY_GEAR_PER_ACTOR } from '@/lib/services/gallery/galleryRequests'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

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

    it('answers 422 once the actor holds the maximum number of gear items', async () => {
      const spy = vi
        .spyOn(database, 'getGalleryGearsByActor')
        .mockResolvedValueOnce(
          Array.from({ length: MAX_GALLERY_GEAR_PER_ACTOR }, (_, index) => ({
            id: `gear-${index}`,
            actorId: ACTOR1_ID,
            kind: 'camera' as const,
            name: `Camera ${index}`,
            brand: null,
            model: null,
            productUrl: null,
            deviceKey: null,
            retiredAt: null,
            createdAt: 1,
            updatedAt: 1
          })) as never
        )
      const createSpy = vi.spyOn(database, 'createGalleryGear')
      createSpy.mockClear()

      const response = await POST(
        postRequest({ kind: 'camera', name: 'One camera too many' }),
        { params: Promise.resolve({}) }
      )

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: 'Too many gear items' })
      expect(createSpy).not.toHaveBeenCalled()
      spy.mockRestore()
      createSpy.mockRestore()
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

    it('redirects to sign-in without a session', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const response = await GET(getRequest(), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(307)
    })
  })
})
