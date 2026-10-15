import { NextRequest } from 'next/server'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import {
  ACTOR1_FOLLOWER_URL,
  ACTOR1_ID,
  seedActor1
} from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { FollowStatus } from '@/lib/types/domain/follow'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import * as routeModule from './route'

const { GET } = routeModule

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockGetConfig = vi.fn().mockReturnValue({
  host: 'llun.test',
  allowEmails: [],
  fitnessStorage: {
    maxFileSize: 4_096
  }
})
vi.mock('@/lib/config', () => ({
  getConfig: () => mockGetConfig()
}))

let mockDatabase: Database | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const mockGetFitnessFile = vi.fn()
vi.mock('@/lib/services/fitness-files', () => ({
  getFitnessFile: (...args: unknown[]) => mockGetFitnessFile(...args)
}))

const mockParseFitnessFile = vi.fn()
vi.mock('@/lib/services/fitness-files/parseFitnessFile', () => ({
  parseFitnessFile: (...args: unknown[]) => mockParseFitnessFile(...args),
  isParseableFitnessFileType: vi.fn().mockReturnValue(true)
}))

const mockReadResponseArrayBufferWithLimit = vi.fn()
vi.mock('@/lib/utils/streamLimit', () => ({
  readResponseArrayBufferWithLimit: (...args: unknown[]) =>
    mockReadResponseArrayBufferWithLimit(...args)
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined
  })
}))

describe('GET /api/v1/fitness-files/[id]/route-data', () => {
  const { database, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      fitnessStorage: {
        maxFileSize: 4_096
      }
    })
    mockReadResponseArrayBufferWithLimit.mockResolvedValue(
      new Uint8Array([1, 2, 3]).buffer
    )
    mockGetFitnessFile.mockResolvedValue({
      type: 'buffer',
      contentType: 'application/vnd.ant.fit',
      buffer: Buffer.from('fit-data')
    })
    mockParseFitnessFile.mockResolvedValue({
      coordinates: [
        { lat: 37.77, lng: -122.42 },
        { lat: 37.78, lng: -122.41 }
      ],
      trackPoints: [
        {
          lat: 37.77,
          lng: -122.42,
          timestamp: new Date('2026-01-01T10:00:00.000Z')
        },
        {
          lat: 37.78,
          lng: -122.41,
          timestamp: new Date('2026-01-01T10:05:00.000Z')
        }
      ],
      totalDistanceMeters: 1_500,
      totalDurationSeconds: 300
    })
  })

  const createRequest = (headers?: Record<string, string>) =>
    new NextRequest(
      'https://llun.test/api/v1/fitness-files/file-id/route-data',
      {
        method: 'GET',
        headers
      }
    )

  const savePrivacyLocation = async () => {
    const existing = await database.getFitnessSettings({
      actorId: ACTOR1_ID,
      serviceType: 'general'
    })

    if (existing) {
      await database.updateFitnessSettings({
        id: existing.id,
        privacyHomeLatitude: 37.77,
        privacyHomeLongitude: -122.42,
        privacyHideRadiusMeters: 50
      })
      return
    }

    await database.createFitnessSettings({
      actorId: ACTOR1_ID,
      serviceType: 'general',
      privacyHomeLatitude: 37.77,
      privacyHomeLongitude: -122.42,
      privacyHideRadiusMeters: 50
    })
  }

  const clearPrivacyLocation = async () => {
    const existing = await database.getFitnessSettings({
      actorId: ACTOR1_ID,
      serviceType: 'general'
    })

    if (existing) {
      await database.updateFitnessSettings({
        id: existing.id,
        privacyHomeLatitude: null,
        privacyHomeLongitude: null,
        privacyHideRadiusMeters: 0
      })
      return
    }

    await database.createFitnessSettings({
      actorId: ACTOR1_ID,
      serviceType: 'general',
      privacyHideRadiusMeters: 0
    })
  }

  // Every test here shares one actor and one `general` fitness settings row, so
  // a zone left behind by one test trims another's default two-point route down
  // to a single visible point and its assertions fail with nothing to explain
  // why. That order dependence predates this file's privacy tests — it fails on
  // `origin/main` under `--sequence.shuffle.tests` too — so reset the row after
  // every test rather than relying on each one to remember.
  afterEach(async () => {
    await clearPrivacyLocation()
  })

  it('serves route samples for public statuses without requiring a session', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/public-route-data`,
      url: `${ACTOR1_ID}/statuses/public-route-data`,
      actorId: ACTOR1_ID,
      text: 'Public route data',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR1_FOLLOWER_URL]
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/public-route-data.fit',
      fileName: 'public-route-data.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=60, must-revalidate'
    )
    expect(response.headers.get('Vary')).toBe('Authorization, Cookie')
    expect(response.headers.get('ETag')).toMatch(/^W\/"route-v1-r1-/)

    const payload = (await response.json()) as {
      samples: Array<{ elapsedSeconds: number; isHiddenByPrivacy: boolean }>
      segments: Array<{
        isHiddenByPrivacy: boolean
        samples: Array<{ elapsedSeconds: number; isHiddenByPrivacy: boolean }>
      }>
      totalDurationSeconds: number
    }

    expect(payload.totalDurationSeconds).toBe(300)
    expect(payload.samples).toHaveLength(2)
    expect(payload.samples[0].elapsedSeconds).toBe(0)
    expect(payload.samples[1].elapsedSeconds).toBe(300)
    expect(payload.samples[0].isHiddenByPrivacy).toBe(false)
    expect(payload.segments).toHaveLength(1)
    expect(payload.segments[0].isHiddenByPrivacy).toBe(false)
    expect(mockGetFitnessFile).toHaveBeenCalledWith(
      database,
      fitnessFile!.id,
      expect.objectContaining({ id: fitnessFile!.id })
    )
    expect(mockParseFitnessFile).toHaveBeenCalledWith({
      fileType: 'fit',
      buffer: Buffer.from('fit-data')
    })
  })

  it('keeps authenticated public route data out of shared caches', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })

    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/authenticated-public-route-data`,
      url: `${ACTOR1_ID}/statuses/authenticated-public-route-data`,
      actorId: ACTOR1_ID,
      text: 'Authenticated public route data',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR1_FOLLOWER_URL]
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/authenticated-public-route-data.fit',
      fileName: 'authenticated-public-route-data.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache')
    expect(response.headers.get('Vary')).toBe('Authorization, Cookie')
    expect(mockParseFitnessFile).toHaveBeenCalled()
  })

  it('uses persistent database cache for route data without re-reading file on subsequent requests', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/public-route-data-cache`,
      url: `${ACTOR1_ID}/statuses/public-route-data-cache`,
      actorId: ACTOR1_ID,
      text: 'Public route data cache',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR1_FOLLOWER_URL]
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/public-route-data-cache.fit',
      fileName: 'public-route-data-cache.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })

    const firstResponse = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })
    const secondResponse = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(mockGetFitnessFile).toHaveBeenCalledTimes(1)
    expect(mockParseFitnessFile).toHaveBeenCalledTimes(1)
  })

  it('does not trust spoofable forwarded headers for anonymous route-data state', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/public-route-data-rate-limit`,
      url: `${ACTOR1_ID}/statuses/public-route-data-rate-limit`,
      actorId: ACTOR1_ID,
      text: 'Public route data rate limit',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR1_FOLLOWER_URL]
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/public-route-data-rate-limit.fit',
      fileName: 'public-route-data-rate-limit.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })

    let response: Response | null = null
    for (let index = 0; index < 3; index += 1) {
      response = await GET(
        createRequest({
          'x-forwarded-for': `198.51.100.${index}, 203.0.113.10`
        }),
        {
          params: Promise.resolve({ id: fitnessFile!.id })
        }
      )
    }

    expect(response?.status).toBe(200)
    expect(mockGetFitnessFile).toHaveBeenCalledTimes(1)
  })

  it('returns not found for private status route data without a session', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/private-route-data`,
      url: `${ACTOR1_ID}/statuses/private-route-data`,
      actorId: ACTOR1_ID,
      text: 'Private route data',
      to: [ACTOR1_FOLLOWER_URL],
      cc: []
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/private-route-data.fit',
      fileName: 'private-route-data.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })

    expect(response.status).toBe(404)
    expect(mockGetFitnessFile).not.toHaveBeenCalled()
    expect(mockParseFitnessFile).not.toHaveBeenCalled()
  })

  it('allows accepted followers to access private follower-only route data', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })

    await database.createFollow({
      actorId: ACTOR2_ID,
      targetActorId: ACTOR1_ID,
      inbox: `${ACTOR2_ID}/inbox`,
      sharedInbox: 'https://llun.test/inbox',
      status: FollowStatus.enum.Accepted
    })

    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/follower-route-data`,
      url: `${ACTOR1_ID}/statuses/follower-route-data`,
      actorId: ACTOR1_ID,
      text: 'Follower route data',
      to: [ACTOR1_FOLLOWER_URL],
      cc: []
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/follower-route-data.fit',
      fileName: 'follower-route-data.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache')
    expect(mockParseFitnessFile).toHaveBeenCalled()
  })

  it('hides home-radius points for non-owner viewers', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })

    await savePrivacyLocation()

    mockParseFitnessFile.mockResolvedValue({
      coordinates: [
        { lat: 37.77, lng: -122.42 },
        { lat: 37.7702, lng: -122.4202 },
        { lat: 37.78, lng: -122.41 },
        { lat: 37.7802, lng: -122.4098 },
        { lat: 37.7701, lng: -122.4201 }
      ],
      trackPoints: [
        {
          lat: 37.77,
          lng: -122.42,
          timestamp: new Date('2026-01-01T10:00:00.000Z')
        },
        {
          lat: 37.7702,
          lng: -122.4202,
          timestamp: new Date('2026-01-01T10:01:00.000Z')
        },
        {
          lat: 37.78,
          lng: -122.41,
          timestamp: new Date('2026-01-01T10:02:00.000Z')
        },
        {
          lat: 37.7802,
          lng: -122.4098,
          timestamp: new Date('2026-01-01T10:03:00.000Z')
        },
        {
          lat: 37.7701,
          lng: -122.4201,
          timestamp: new Date('2026-01-01T10:04:00.000Z')
        }
      ],
      totalDistanceMeters: 2_000,
      totalDurationSeconds: 240
    })

    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/public-route-data-hidden-zone`,
      url: `${ACTOR1_ID}/statuses/public-route-data-hidden-zone`,
      actorId: ACTOR1_ID,
      text: 'Public route with hidden home zone',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR1_FOLLOWER_URL]
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/public-route-data-hidden-zone.fit',
      fileName: 'public-route-data-hidden-zone.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })
    const payload = (await response.json()) as {
      samples: Array<{ isHiddenByPrivacy: boolean }>
      segments: Array<{ isHiddenByPrivacy: boolean; samples: unknown[] }>
    }

    expect(response.status).toBe(200)
    expect(payload.samples).toHaveLength(2)
    expect(payload.samples.every((sample) => !sample.isHiddenByPrivacy)).toBe(
      true
    )
    expect(payload.segments).toHaveLength(1)
    expect(payload.segments[0].isHiddenByPrivacy).toBe(false)
    expect(payload.segments[0].samples).toHaveLength(2)
  })

  // Starts inside the 50m home zone, heads ~1.4km out, returns THROUGH the zone
  // centre at index 3, then heads out again and finishes ~2.8km away — so only
  // the head is trimmed and the mid-route pass has to stay inside one segment.
  const REENTRY_ROUTE_COORDINATES = [
    { lat: 37.77, lng: -122.42 },
    { lat: 37.7702, lng: -122.4202 },
    { lat: 37.78, lng: -122.41 },
    { lat: 37.77, lng: -122.42 },
    { lat: 37.78, lng: -122.41 },
    { lat: 37.79, lng: -122.4 }
  ]

  const mockReentryRoute = () => {
    mockParseFitnessFile.mockResolvedValue({
      coordinates: REENTRY_ROUTE_COORDINATES,
      trackPoints: REENTRY_ROUTE_COORDINATES.map((coordinate, index) => ({
        ...coordinate,
        timestamp: new Date(Date.UTC(2026, 0, 1, 10, index))
      })),
      totalDistanceMeters: 6_000,
      totalDurationSeconds: 300
    })
  }

  it('keeps a mid-route privacy zone pass in one segment for other viewers', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })

    await savePrivacyLocation()
    mockReentryRoute()

    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/public-route-data-reentry-zone`,
      url: `${ACTOR1_ID}/statuses/public-route-data-reentry-zone`,
      actorId: ACTOR1_ID,
      text: 'Public route that passes back through the home zone',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR1_FOLLOWER_URL]
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/reentry-zone-viewer.fit',
      fileName: 'reentry-zone-viewer.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 2_048
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })
    const payload = (await response.json()) as {
      samples: Array<{ lat: number; lng: number; isHiddenByPrivacy: boolean }>
      segments: Array<{
        isHiddenByPrivacy: boolean
        samples: Array<{ lat: number; lng: number }>
      }>
    }

    expect(response.status).toBe(200)
    // One unbroken line, not two either side of a hole at the zone centre.
    expect(payload.segments).toHaveLength(1)
    expect(payload.segments[0].isHiddenByPrivacy).toBe(false)
    expect(payload.segments[0].samples).toHaveLength(4)
    expect(payload.segments[0].samples).toContainEqual(
      expect.objectContaining({ lat: 37.77, lng: -122.42 })
    )
    expect(payload.samples).toHaveLength(4)
  })

  it('trims only the head when a re-entering route finishes outside every zone', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    await savePrivacyLocation()
    mockReentryRoute()

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      path: 'fitness/reentry-zone-owner.fit',
      fileName: 'reentry-zone-owner.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 2_048
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })
    const payload = (await response.json()) as {
      samples: Array<{ isHiddenByPrivacy: boolean }>
      segments: Array<{ isHiddenByPrivacy: boolean; samples: unknown[] }>
    }

    expect(response.status).toBe(200)
    expect(payload.samples).toHaveLength(6)
    // Hidden head, then everything else — no trailing hidden segment, because
    // the activity does not finish inside a zone.
    expect(
      payload.segments.map((segment) => segment.isHiddenByPrivacy)
    ).toEqual([true, false])
    expect(payload.segments[0].samples).toHaveLength(2)
    expect(payload.segments[1].samples).toHaveLength(4)
  })

  it('returns hidden points flagged for the owner account', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    await savePrivacyLocation()

    mockParseFitnessFile.mockResolvedValue({
      coordinates: [
        { lat: 37.77, lng: -122.42 },
        { lat: 37.7702, lng: -122.4202 },
        { lat: 37.78, lng: -122.41 },
        { lat: 37.7802, lng: -122.4098 },
        { lat: 37.7701, lng: -122.4201 }
      ],
      trackPoints: [
        {
          lat: 37.77,
          lng: -122.42,
          timestamp: new Date('2026-01-01T10:00:00.000Z')
        },
        {
          lat: 37.7702,
          lng: -122.4202,
          timestamp: new Date('2026-01-01T10:01:00.000Z')
        },
        {
          lat: 37.78,
          lng: -122.41,
          timestamp: new Date('2026-01-01T10:02:00.000Z')
        },
        {
          lat: 37.7802,
          lng: -122.4098,
          timestamp: new Date('2026-01-01T10:03:00.000Z')
        },
        {
          lat: 37.7701,
          lng: -122.4201,
          timestamp: new Date('2026-01-01T10:04:00.000Z')
        }
      ],
      totalDistanceMeters: 2_000,
      totalDurationSeconds: 240
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      path: 'fitness/owner-hidden-zone.fit',
      fileName: 'owner-hidden-zone.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 2_048
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })
    const payload = (await response.json()) as {
      samples: Array<{ isHiddenByPrivacy: boolean }>
      segments: Array<{ isHiddenByPrivacy: boolean; samples: unknown[] }>
    }

    expect(response.status).toBe(200)
    expect(payload.samples).toHaveLength(5)
    expect(payload.samples.some((sample) => sample.isHiddenByPrivacy)).toBe(
      true
    )
    expect(payload.segments).toHaveLength(3)
    expect(payload.segments[0].isHiddenByPrivacy).toBe(true)
    expect(payload.segments[1].isHiddenByPrivacy).toBe(false)
    expect(payload.segments[2].isHiddenByPrivacy).toBe(true)
  })

  it('updates route path after privacy settings change', async () => {
    mockGetServerSession.mockResolvedValue(null)

    mockParseFitnessFile.mockResolvedValue({
      coordinates: [
        { lat: 37.77, lng: -122.42 },
        { lat: 37.7702, lng: -122.4202 },
        { lat: 37.78, lng: -122.41 },
        { lat: 37.7802, lng: -122.4098 },
        { lat: 37.7701, lng: -122.4201 }
      ],
      trackPoints: [
        {
          lat: 37.77,
          lng: -122.42,
          timestamp: new Date('2026-01-01T10:00:00.000Z')
        },
        {
          lat: 37.7702,
          lng: -122.4202,
          timestamp: new Date('2026-01-01T10:01:00.000Z')
        },
        {
          lat: 37.78,
          lng: -122.41,
          timestamp: new Date('2026-01-01T10:02:00.000Z')
        },
        {
          lat: 37.7802,
          lng: -122.4098,
          timestamp: new Date('2026-01-01T10:03:00.000Z')
        },
        {
          lat: 37.7701,
          lng: -122.4201,
          timestamp: new Date('2026-01-01T10:04:00.000Z')
        }
      ],
      totalDistanceMeters: 2_000,
      totalDurationSeconds: 240
    })

    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/public-route-data-live-privacy`,
      url: `${ACTOR1_ID}/statuses/public-route-data-live-privacy`,
      actorId: ACTOR1_ID,
      text: 'Public route with live privacy settings',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR1_FOLLOWER_URL]
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/public-route-data-live-privacy.fit',
      fileName: 'public-route-data-live-privacy.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })

    await clearPrivacyLocation()

    const firstResponse = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })
    const firstPayload = (await firstResponse.json()) as {
      samples: Array<{ isHiddenByPrivacy: boolean }>
      segments: Array<{ isHiddenByPrivacy: boolean; samples: unknown[] }>
    }

    expect(firstResponse.status).toBe(200)
    expect(firstPayload.samples).toHaveLength(5)
    expect(firstPayload.segments).toHaveLength(1)
    expect(firstPayload.segments[0].samples).toHaveLength(5)

    await savePrivacyLocation()

    const secondResponse = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })
    const secondPayload = (await secondResponse.json()) as {
      samples: Array<{ isHiddenByPrivacy: boolean }>
      segments: Array<{ isHiddenByPrivacy: boolean; samples: unknown[] }>
    }

    expect(secondResponse.status).toBe(200)
    expect(secondPayload.samples).toHaveLength(2)
    expect(
      secondPayload.samples.every((sample) => !sample.isHiddenByPrivacy)
    ).toBe(true)
    expect(secondPayload.segments).toHaveLength(1)
    expect(secondPayload.segments[0].isHiddenByPrivacy).toBe(false)
    expect(secondPayload.segments[0].samples).toHaveLength(2)
  })

  it('allows owner access to unlinked uploaded file route data', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      path: 'fitness/owner-route-data.fit',
      fileName: 'owner-route-data.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 2_048
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache')
    expect(mockParseFitnessFile).toHaveBeenCalled()
  })

  it('carries power, cadence, temperature, balance, distance, laps and calories', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const laps = [
      {
        startElapsedSeconds: 0,
        durationSeconds: 150,
        distanceMeters: 700,
        avgPower: 210,
        avgCadence: 88
      }
    ]
    mockParseFitnessFile.mockResolvedValue({
      coordinates: [
        { lat: 37.77, lng: -122.42 },
        { lat: 37.78, lng: -122.41 }
      ],
      trackPoints: [
        {
          lat: 37.77,
          lng: -122.42,
          timestamp: new Date('2026-01-01T10:00:00.000Z'),
          power: 200,
          cadence: 85,
          temperature: 18,
          leftRightBalance: 48.5,
          distanceMeters: 0
        },
        {
          lat: 37.78,
          lng: -122.41,
          timestamp: new Date('2026-01-01T10:05:00.000Z')
        }
      ],
      totalDistanceMeters: 1_500,
      totalDurationSeconds: 300,
      laps,
      calories: 120
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      path: 'fitness/extra-metrics-route-data.fit',
      fileName: 'extra-metrics-route-data.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 2_048
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.laps).toEqual(laps)
    expect(payload.calories).toBe(120)
    expect(payload.samples[0]).toMatchObject({
      power: 200,
      cadence: 85,
      temperature: 18,
      leftRightBalance: 48.5,
      distanceMeters: 0
    })
    expect(payload.segments[0].samples[0]).toMatchObject({
      power: 200,
      cadence: 85,
      temperature: 18,
      leftRightBalance: 48.5,
      distanceMeters: 0
    })
    // Fields the file did not record are omitted, not emitted as null.
    for (const key of [
      'power',
      'cadence',
      'temperature',
      'leftRightBalance',
      'distanceMeters'
    ]) {
      expect(payload.samples[1]).not.toHaveProperty(key)
    }
  })

  it('omits laps and calories when the file has none', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    // An empty lap list must not be echoed back as `laps: []`.
    mockParseFitnessFile.mockResolvedValue({
      coordinates: [{ lat: 37.77, lng: -122.42 }],
      trackPoints: [{ lat: 37.77, lng: -122.42 }],
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      laps: []
    })
    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      path: 'fitness/no-laps-route-data.fit',
      fileName: 'no-laps-route-data.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 2_048
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })
    const payload = await response.json()

    expect(payload).not.toHaveProperty('laps')
    expect(payload).not.toHaveProperty('calories')
  })

  it('measures distance from the first visible sample for non-owners behind a privacy zone', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
    await savePrivacyLocation()
    const laps = [
      { startElapsedSeconds: 0, durationSeconds: 240, distanceMeters: 2_800 }
    ]
    mockParseFitnessFile.mockResolvedValue({
      coordinates: REENTRY_ROUTE_COORDINATES,
      trackPoints: REENTRY_ROUTE_COORDINATES.map((coordinate, index) => ({
        ...coordinate,
        timestamp: new Date(Date.UTC(2026, 0, 1, 10, index)),
        distanceMeters: [0, 20, 1_400, 1_450, 1_460, 2_800][index]
      })),
      totalDistanceMeters: 2_800,
      totalDurationSeconds: 300,
      laps
    })
    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/public-route-data-rebased-distance`,
      url: `${ACTOR1_ID}/statuses/public-route-data-rebased-distance`,
      actorId: ACTOR1_ID,
      text: 'Public route with hidden start',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR1_FOLLOWER_URL]
    })
    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/public-route-data-rebased-distance.fit',
      fileName: 'public-route-data-rebased-distance.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })
    const payload = (await response.json()) as {
      samples: Array<{ distanceMeters: number }>
      segments: Array<{ samples: Array<{ distanceMeters: number }> }>
      laps: unknown
    }

    expect(response.status).toBe(200)
    // Index 0 and 1 sit inside the zone and are dropped; the first visible
    // sample (1,400 m into the file) becomes distance 0.
    expect(payload.samples.map((sample) => sample.distanceMeters)).toEqual([
      0, 50, 60, 1_400
    ])
    expect(
      payload.segments[0].samples.map((sample) => sample.distanceMeters)
    ).toEqual([0, 50, 60, 1_400])
    expect(payload.laps).toEqual(laps)
  })

  it('keeps recorded distance for the owner even behind a privacy zone', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    await savePrivacyLocation()
    mockParseFitnessFile.mockResolvedValue({
      coordinates: REENTRY_ROUTE_COORDINATES,
      trackPoints: REENTRY_ROUTE_COORDINATES.map((coordinate, index) => ({
        ...coordinate,
        timestamp: new Date(Date.UTC(2026, 0, 1, 10, index)),
        distanceMeters: [0, 20, 1_400, 1_450, 1_460, 2_800][index]
      })),
      totalDistanceMeters: 2_800,
      totalDurationSeconds: 300
    })
    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      path: 'fitness/owner-recorded-distance.fit',
      fileName: 'owner-recorded-distance.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })
    const payload = (await response.json()) as {
      samples: Array<{ distanceMeters: number }>
    }

    expect(payload.samples.map((sample) => sample.distanceMeters)).toEqual([
      0, 20, 1_400, 1_450, 1_460, 2_800
    ])
  })

  it('keeps the extra metrics on points kept by downsampling', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const start = new Date('2026-01-01T10:00:00.000Z').getTime()
    const trackPoints = Array.from({ length: 3_000 }, (_, index) => ({
      lat: 37.77 + index * 0.00001,
      lng: -122.42 + index * 0.00001,
      timestamp: new Date(start + index * 1_000),
      cadence: 80 + (index % 10),
      distanceMeters: index * 5
    }))
    mockParseFitnessFile.mockResolvedValue({
      coordinates: trackPoints.map(({ lat, lng }) => ({ lat, lng })),
      trackPoints,
      totalDistanceMeters: 15_000,
      totalDurationSeconds: 3_000
    })
    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      path: 'fitness/downsample-route-data.fit',
      fileName: 'downsample-route-data.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 2_048
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })
    const payload = (await response.json()) as {
      samples: Array<{ cadence?: number; distanceMeters?: number }>
    }

    expect(payload.samples.length).toBeLessThan(3_000)
    expect(payload.samples.length).toBeGreaterThan(1)
    expect(
      payload.samples.every(
        (sample) =>
          typeof sample.cadence === 'number' &&
          typeof sample.distanceMeters === 'number'
      )
    ).toBe(true)
  })

  describe('metricSamples', () => {
    const createOwnedFile = (name: string) =>
      database.createFitnessFile({
        actorId: ACTOR1_ID,
        path: `fitness/${name}.fit`,
        fileName: `${name}.fit`,
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 2_048
      })

    const getAsOwner = async (name: string) => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      const fitnessFile = await createOwnedFile(name)
      const response = await GET(createRequest(), {
        params: Promise.resolve({ id: fitnessFile!.id })
      })
      expect(response.status).toBe(200)
      return response.json()
    }

    it('returns time-aligned samples for activities with no GPS track', async () => {
      const start = new Date('2026-01-04T08:00:00.000Z')
      mockParseFitnessFile.mockResolvedValue({
        coordinates: [],
        trackPoints: [],
        metricPoints: [
          { timestamp: start, power: 180, heartRate: 135, distanceMeters: 0 },
          {
            timestamp: new Date(start.getTime() + 5_000),
            power: 200,
            cadence: 82,
            temperature: 24,
            leftRightBalance: 49,
            speed: 30,
            altitude: 12
          }
        ],
        totalDistanceMeters: 0,
        totalDurationSeconds: 5
      })

      const payload = await getAsOwner('indoor-metric-samples')

      expect(payload.samples).toEqual([])
      expect(payload.metricSamples).toEqual([
        {
          elapsedSeconds: 0,
          timestamp: start.getTime(),
          power: 180,
          heartRate: 135,
          distanceMeters: 0
        },
        {
          elapsedSeconds: 5,
          timestamp: start.getTime() + 5_000,
          power: 200,
          cadence: 82,
          temperature: 24,
          leftRightBalance: 49,
          speed: 30,
          altitude: 12
        }
      ])
    })

    it('spreads samples over the duration when they carry no timestamps and downsamples long ones', async () => {
      mockParseFitnessFile.mockResolvedValue({
        coordinates: [],
        trackPoints: [],
        metricPoints: Array.from({ length: 3_001 }, (_, index) => ({
          power: index
        })),
        totalDistanceMeters: 0,
        totalDurationSeconds: 3_000
      })

      const payload = (await getAsOwner('indoor-downsampled')) as {
        metricSamples: Array<{ elapsedSeconds: number; power: number }>
      }

      expect(payload.metricSamples).toHaveLength(1_500)
      expect(payload.metricSamples[0]).toEqual({ elapsedSeconds: 0, power: 0 })
      expect(payload.metricSamples.at(-1)).toEqual({
        elapsedSeconds: 3_000,
        power: 3_000
      })
    })

    it('does not send metricSamples for activities with a GPS track', async () => {
      mockParseFitnessFile.mockResolvedValue({
        coordinates: [
          { lat: 37.77, lng: -122.42 },
          { lat: 37.78, lng: -122.41 }
        ],
        trackPoints: [
          {
            lat: 37.77,
            lng: -122.42,
            timestamp: new Date('2026-01-01T10:00:00.000Z')
          },
          {
            lat: 37.78,
            lng: -122.41,
            timestamp: new Date('2026-01-01T10:05:00.000Z')
          }
        ],
        metricPoints: [{ power: 200 }, { power: 210 }],
        totalDistanceMeters: 1_500,
        totalDurationSeconds: 300
      })

      const payload = await getAsOwner('outdoor-no-metric-samples')

      expect(payload.samples).toHaveLength(2)
      expect(payload).not.toHaveProperty('metricSamples')
    })
  })

  it('uses configured fitness size limit for redirect downloads', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      fitnessStorage: {
        maxFileSize: 123_456
      }
    })
    mockGetFitnessFile.mockResolvedValueOnce({
      type: 'redirect',
      redirectUrl: 'https://storage.example/fitness/redirect-route-data.fit'
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', {
        status: 200
      })
    )

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      path: 'fitness/redirect-route-data.fit',
      fileName: 'redirect-route-data.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 75_000_000
    })

    try {
      const response = await GET(createRequest(), {
        params: Promise.resolve({ id: fitnessFile!.id })
      })

      expect(response.status).toBe(200)
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://storage.example/fitness/redirect-route-data.fit'
      )
      expect(mockReadResponseArrayBufferWithLimit).toHaveBeenCalledWith(
        expect.any(Response),
        123_456,
        'Fitness redirect body'
      )
      expect(mockParseFitnessFile).toHaveBeenCalledWith({
        fileType: 'fit',
        buffer: Buffer.from([1, 2, 3])
      })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  describe('pre-parsed route data cache and ETag', () => {
    it('serves from pre-parsed cache without downloading buffer or parsing file on cache hit', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const status = await database.createNote({
        id: `${ACTOR1_ID}/statuses/cache-hit-test`,
        url: `${ACTOR1_ID}/statuses/cache-hit-test`,
        actorId: ACTOR1_ID,
        text: 'Cache hit test',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [ACTOR1_FOLLOWER_URL]
      })

      const fitnessFile = await database.createFitnessFile({
        actorId: ACTOR1_ID,
        statusId: status.id,
        path: 'fitness/cache-hit-test.fit',
        fileName: 'cache-hit-test.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1_024
      })

      // Pre-seed cache
      await database.upsertFitnessFileRouteData({
        fitnessFileId: fitnessFile!.id,
        actorId: ACTOR1_ID,
        sourceVersion: 1,
        routeData: JSON.stringify({
          version: 1,
          totalDurationSeconds: 400,
          routeSamples: [
            {
              lat: 37.77,
              lng: -122.42,
              elapsedSeconds: 0,
              distanceMeters: 0
            },
            {
              lat: 37.78,
              lng: -122.41,
              elapsedSeconds: 400,
              distanceMeters: 2000
            }
          ]
        })
      })

      mockGetFitnessFile.mockClear()
      mockParseFitnessFile.mockClear()

      const response = await GET(createRequest(), {
        params: Promise.resolve({ id: fitnessFile!.id })
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.totalDurationSeconds).toBe(400)
      expect(data.samples).toHaveLength(2)
      expect(mockGetFitnessFile).not.toHaveBeenCalled()
      expect(mockParseFitnessFile).not.toHaveBeenCalled()
    })

    it('returns 304 Not Modified when If-None-Match matches ETag', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const status = await database.createNote({
        id: `${ACTOR1_ID}/statuses/etag-304-test`,
        url: `${ACTOR1_ID}/statuses/etag-304-test`,
        actorId: ACTOR1_ID,
        text: 'ETag test',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [ACTOR1_FOLLOWER_URL]
      })

      const fitnessFile = await database.createFitnessFile({
        actorId: ACTOR1_ID,
        statusId: status.id,
        path: 'fitness/etag-304-test.fit',
        fileName: 'etag-304-test.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1_024
      })

      const firstResponse = await GET(createRequest(), {
        params: Promise.resolve({ id: fitnessFile!.id })
      })

      expect(firstResponse.status).toBe(200)
      const etag = firstResponse.headers.get('ETag')
      expect(etag).toBeTruthy()

      mockGetFitnessFile.mockClear()
      mockParseFitnessFile.mockClear()
      const getRouteDataSpy = vi.spyOn(database, 'getFitnessFileRouteData')

      // Request with matching If-None-Match header
      const secondResponse = await GET(
        createRequest({ 'if-none-match': etag! }),
        {
          params: Promise.resolve({ id: fitnessFile!.id })
        }
      )

      expect(secondResponse.status).toBe(304)
      expect(secondResponse.headers.get('ETag')).toBe(etag)
      expect(secondResponse.headers.get('Vary')).toBe('Authorization, Cookie')
      const text = await secondResponse.text()
      expect(text).toBe('')
      expect(getRouteDataSpy).not.toHaveBeenCalled()
      expect(mockGetFitnessFile).not.toHaveBeenCalled()
      expect(mockParseFitnessFile).not.toHaveBeenCalled()
      getRouteDataSpy.mockRestore()
    })

    it('separates owner and viewer ETags so an owner ETag does not 304 for a non-owner viewer', async () => {
      const status = await database.createNote({
        id: `${ACTOR1_ID}/statuses/etag-owner-viewer-test`,
        url: `${ACTOR1_ID}/statuses/etag-owner-viewer-test`,
        actorId: ACTOR1_ID,
        text: 'ETag owner vs viewer test',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [ACTOR1_FOLLOWER_URL]
      })

      const fitnessFile = await database.createFitnessFile({
        actorId: ACTOR1_ID,
        statusId: status.id,
        path: 'fitness/etag-owner-viewer-test.fit',
        fileName: 'etag-owner-viewer-test.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1_024
      })

      mockGetServerSession.mockResolvedValueOnce({
        user: { email: seedActor1.email }
      })
      const ownerResponse = await GET(createRequest(), {
        params: Promise.resolve({ id: fitnessFile!.id })
      })
      expect(ownerResponse.status).toBe(200)
      const ownerEtag = ownerResponse.headers.get('ETag')
      expect(ownerEtag).toMatch(/^W\/"route-v1-r1-.*-owner-/)

      mockGetServerSession.mockResolvedValueOnce(null)
      const viewerResponse = await GET(
        createRequest({ 'if-none-match': ownerEtag! }),
        {
          params: Promise.resolve({ id: fitnessFile!.id })
        }
      )
      expect(viewerResponse.status).toBe(200)
      const viewerEtag = viewerResponse.headers.get('ETag')
      expect(viewerEtag).toMatch(/^W\/"route-v1-r1-.*-viewer-/)
      expect(viewerEtag).not.toBe(ownerEtag)
    })

    it('changes owner ETag when privacy location or radius changes', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const fitnessFile = await database.createFitnessFile({
        actorId: ACTOR1_ID,
        path: 'fitness/owner-etag-privacy-test.fit',
        fileName: 'owner-etag-privacy-test.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1_024
      })

      await clearPrivacyLocation()

      const firstResponse = await GET(createRequest(), {
        params: Promise.resolve({ id: fitnessFile!.id })
      })
      expect(firstResponse.status).toBe(200)
      const firstEtag = firstResponse.headers.get('ETag')
      expect(firstEtag).toMatch(/^W\/"route-v1-r1-.*-owner-/)

      await savePrivacyLocation()

      // Requesting with the old ETag after privacy settings changed must return 200 with a new ETag
      const secondResponse = await GET(
        createRequest({ 'if-none-match': firstEtag! }),
        {
          params: Promise.resolve({ id: fitnessFile!.id })
        }
      )
      expect(secondResponse.status).toBe(200)
      const secondEtag = secondResponse.headers.get('ETag')
      expect(secondEtag).toMatch(/^W\/"route-v1-r1-.*-owner-/)
      expect(secondEtag).not.toBe(firstEtag)
    })

    it('lazily backfills pre-parsed route data on cache miss before responding', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const status = await database.createNote({
        id: `${ACTOR1_ID}/statuses/lazy-backfill-test`,
        url: `${ACTOR1_ID}/statuses/lazy-backfill-test`,
        actorId: ACTOR1_ID,
        text: 'Lazy backfill test',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [ACTOR1_FOLLOWER_URL]
      })

      const fitnessFile = await database.createFitnessFile({
        actorId: ACTOR1_ID,
        statusId: status.id,
        path: 'fitness/lazy-backfill-test.fit',
        fileName: 'lazy-backfill-test.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1_024
      })

      // Ensure no cached row exists initially
      const initialRow = await database.getFitnessFileRouteData({
        fitnessFileId: fitnessFile!.id
      })
      expect(initialRow).toBeNull()

      const response = await GET(createRequest(), {
        params: Promise.resolve({ id: fitnessFile!.id })
      })

      expect(response.status).toBe(200)

      const cachedRow = await database.getFitnessFileRouteData({
        fitnessFileId: fitnessFile!.id
      })
      expect(cachedRow).not.toBeNull()
      expect(cachedRow!.actorId).toBe(ACTOR1_ID)
      expect(cachedRow!.sourceVersion).toBe(1)
      const parsed = JSON.parse(cachedRow!.routeData)
      expect(parsed.routeSamples).toBeDefined()
    })

    it('masks privacy zones identically on cache hit', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const status = await database.createNote({
        id: `${ACTOR1_ID}/statuses/privacy-cache-hit-test`,
        url: `${ACTOR1_ID}/statuses/privacy-cache-hit-test`,
        actorId: ACTOR1_ID,
        text: 'Privacy cache hit test',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [ACTOR1_FOLLOWER_URL]
      })

      const fitnessFile = await database.createFitnessFile({
        actorId: ACTOR1_ID,
        statusId: status.id,
        path: 'fitness/privacy-cache-hit-test.fit',
        fileName: 'privacy-cache-hit-test.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1_024
      })

      // Pre-seed cache with 3 points
      await database.upsertFitnessFileRouteData({
        fitnessFileId: fitnessFile!.id,
        actorId: ACTOR1_ID,
        sourceVersion: 1,
        routeData: JSON.stringify({
          version: 1,
          totalDurationSeconds: 600,
          routeSamples: [
            {
              lat: 37.77,
              lng: -122.42,
              elapsedSeconds: 0,
              distanceMeters: 0
            },
            {
              lat: 37.775,
              lng: -122.415,
              elapsedSeconds: 300,
              distanceMeters: 500
            },
            {
              lat: 37.78,
              lng: -122.41,
              elapsedSeconds: 600,
              distanceMeters: 1000
            }
          ]
        })
      })

      await savePrivacyLocation()

      try {
        mockGetFitnessFile.mockClear()

        // Anonymous non-owner viewer
        const nonOwnerResponse = await GET(createRequest(), {
          params: Promise.resolve({ id: fitnessFile!.id })
        })
        expect(nonOwnerResponse.status).toBe(200)
        const nonOwnerData = await nonOwnerResponse.json()
        expect(mockGetFitnessFile).not.toHaveBeenCalled()
        // Hidden head is excluded, distance rebased
        expect(
          nonOwnerData.samples.every(
            (s: { isHiddenByPrivacy: boolean }) => !s.isHiddenByPrivacy
          )
        ).toBe(true)
        expect(nonOwnerData.samples[0].distanceMeters).toBe(0)
        expect(
          nonOwnerData.segments.every(
            (s: { isHiddenByPrivacy: boolean }) => !s.isHiddenByPrivacy
          )
        ).toBe(true)

        // Owner viewer
        mockGetServerSession.mockResolvedValueOnce({
          user: { email: seedActor1.email }
        })
        const ownerResponse = await GET(createRequest(), {
          params: Promise.resolve({ id: fitnessFile!.id })
        })
        expect(ownerResponse.status).toBe(200)
        const ownerData = await ownerResponse.json()
        expect(ownerData.samples).toHaveLength(3)
        expect(ownerData.samples[0].isHiddenByPrivacy).toBe(true)
        expect(ownerData.samples[0].distanceMeters).toBe(0)
        expect(
          ownerData.segments.some(
            (s: { isHiddenByPrivacy: boolean }) => s.isHiddenByPrivacy
          )
        ).toBe(true)
      } finally {
        await clearPrivacyLocation()
      }
    })
  })
})
