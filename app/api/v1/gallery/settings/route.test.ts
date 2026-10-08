import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { DEFAULT_GALLERY_SETTINGS } from '@/lib/types/database/gallery'

import { GET, PUT } from './route'

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
  getConfig: vi.fn()
}))

const configWith = (altText?: object) => ({
  host: 'llun.test',
  secretPhase: 'test-secret',
  allowEmails: [],
  allowActorDomains: [],
  ...(altText ? { altText } : {})
})

describe('/api/v1/gallery/settings', () => {
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

  beforeEach(async () => {
    vi.clearAllMocks()
    // Every test starts from the defaults, whatever ran before it.
    await database.updateGallerySettings({
      actorId: ACTOR1_ID,
      ...DEFAULT_GALLERY_SETTINGS
    })
    vi.mocked(getConfig).mockReturnValue(configWith() as never)
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const getRequest = () =>
    new NextRequest('https://llun.test/api/v1/gallery/settings', {
      method: 'GET'
    })

  const putRequest = (body: unknown, raw = false) =>
    new NextRequest('https://llun.test/api/v1/gallery/settings', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'https://llun.test'
      },
      body: raw ? (body as string) : JSON.stringify(body)
    })

  const context = { params: Promise.resolve({}) }

  describe('GET', () => {
    it('returns the defaults, flat, when nothing was saved', async () => {
      const response = await GET(getRequest(), context)

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        ...DEFAULT_GALLERY_SETTINGS,
        altTextAvailable: false
      })
    })

    it.each([
      [
        'is configured',
        { endpoint: 'https://x', apiKey: 'k', model: 'm' },
        true
      ],
      ['is not configured', undefined, false]
    ])(
      'reports altTextAvailable when alt text %s',
      async (_, altText, expected) => {
        vi.mocked(getConfig).mockReturnValue(configWith(altText) as never)

        const response = await GET(getRequest(), context)

        expect((await response.json()).altTextAvailable).toBe(expected)
      }
    )

    it('redirects to sign-in without a session', async () => {
      mockGetServerSession.mockResolvedValue(null)

      expect((await GET(getRequest(), context)).status).toBe(307)
    })
  })

  describe('PUT', () => {
    it('saves the given settings and returns them all', async () => {
      const response = await PUT(
        putRequest({
          autoDescribe: false,
          galleryDefault: 'always',
          defaultPlacePrecision: 'country',
          hiddenLocations: [
            { latitude: 51.5, longitude: -0.1, hideRadiusMeters: 500 }
          ]
        }),
        context
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        ...DEFAULT_GALLERY_SETTINGS,
        autoDescribe: false,
        galleryDefault: 'always',
        defaultPlacePrecision: 'country',
        hiddenLocations: [
          { latitude: 51.5, longitude: -0.1, hideRadiusMeters: 500 }
        ],
        altTextAvailable: false
      })
      expect(
        await database.getGallerySettings({ actorId: ACTOR1_ID })
      ).toMatchObject({ autoDescribe: false, galleryDefault: 'always' })
    })

    it('leaves the settings it was not sent alone', async () => {
      await PUT(putRequest({ showGear: false }), context)
      const response = await PUT(putRequest({ mapPublic: false }), context)

      expect(await response.json()).toMatchObject({
        showGear: false,
        mapPublic: false
      })
    })

    it.each([
      ['an unknown galleryDefault', { galleryDefault: 'sometimes' }],
      ['an unknown precision', { defaultPlacePrecision: 'street' }],
      ['a string where a boolean belongs', { autoDescribe: 'yes' }],
      ['hiddenLocations that is not a list', { hiddenLocations: 'home' }],
      [
        'hiddenLocations entries that are not objects',
        { hiddenLocations: [1] }
      ],
      [
        'too many hiddenLocations',
        {
          hiddenLocations: Array.from({ length: 51 }, (_, index) => ({
            latitude: index,
            longitude: 0,
            hideRadiusMeters: 100
          }))
        }
      ],
      [
        'a hidden location with an unknown key',
        {
          hiddenLocations: [
            { latitude: 1, longitude: 2, hideRadiusMeters: 100, name: 'Home' }
          ]
        }
      ],
      ['a non-object body', []],
      [
        'a hidden location missing its radius',
        { hiddenLocations: [{ latitude: 1, longitude: 2 }] }
      ],
      [
        'a latitude out of range',
        {
          hiddenLocations: [
            { latitude: 91, longitude: 2, hideRadiusMeters: 100 }
          ]
        }
      ],
      [
        'a longitude out of range',
        {
          hiddenLocations: [
            { latitude: 1, longitude: -181, hideRadiusMeters: 100 }
          ]
        }
      ],
      [
        'a hidden location coordinate that is a string',
        {
          hiddenLocations: [
            { latitude: '1', longitude: 2, hideRadiusMeters: 100 }
          ]
        }
      ],
      [
        'a zero radius',
        {
          hiddenLocations: [{ latitude: 1, longitude: 2, hideRadiusMeters: 0 }]
        }
      ],
      [
        'a negative radius',
        {
          hiddenLocations: [{ latitude: 1, longitude: 2, hideRadiusMeters: -5 }]
        }
      ],
      [
        'a radius above the largest option',
        {
          hiddenLocations: [
            { latitude: 1, longitude: 2, hideRadiusMeters: 1001 }
          ]
        }
      ]
    ])('answers 422 for %s', async (_, body) => {
      const response = await PUT(putRequest(body), context)

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: 'Unprocessable entity' })
    })

    it('keeps the stored hidden locations when a 422 rejects the update', async () => {
      await PUT(
        putRequest({
          hiddenLocations: [
            { latitude: 51.5, longitude: -0.1, hideRadiusMeters: 500 }
          ]
        }),
        context
      )

      const response = await PUT(
        putRequest({
          hiddenLocations: [
            { latitude: 1, longitude: 2, hideRadiusMeters: 100, name: 'x' }
          ]
        }),
        context
      )

      expect(response.status).toBe(422)
      expect(
        (await database.getGallerySettings({ actorId: ACTOR1_ID }))
          .hiddenLocations
      ).toEqual([{ latitude: 51.5, longitude: -0.1, hideRadiusMeters: 500 }])
    })

    it.each([
      [1, 50],
      [50, 50],
      [51, 100],
      [150, 200],
      [201, 500],
      [501, 1000],
      [1000, 1000]
    ])('snaps a %sm radius up to %sm', async (radius, snapped) => {
      const response = await PUT(
        putRequest({
          hiddenLocations: [
            { latitude: 51.5, longitude: -0.1, hideRadiusMeters: radius }
          ]
        }),
        context
      )

      expect(response.status).toBe(200)
      const expected = [
        { latitude: 51.5, longitude: -0.1, hideRadiusMeters: snapped }
      ]
      expect((await response.json()).hiddenLocations).toEqual(expected)
      expect(
        (await database.getGallerySettings({ actorId: ACTOR1_ID }))
          .hiddenLocations
      ).toEqual(expected)
    })

    it('answers 400 for a body that is not JSON', async () => {
      const response = await PUT(putRequest('{nope', true), context)

      expect(response.status).toBe(400)
    })

    it('rejects a cross-site request', async () => {
      const response = await PUT(
        new NextRequest('https://llun.test/api/v1/gallery/settings', {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            origin: 'https://evil.test'
          },
          body: JSON.stringify({ showGear: false })
        }),
        context
      )

      expect(response.status).toBe(403)
    })
  })
})
