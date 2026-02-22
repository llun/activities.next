import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import {
  ACTOR1_FOLLOWER_URL,
  ACTOR1_ID,
  seedActor1
} from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { FollowStatus } from '@/lib/types/domain/follow'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET } from './route'

const mockGetServerSession = jest.fn()
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args)
}))

jest.mock('@/app/api/auth/[...nextauth]/authOptions', () => ({
  getAuthOptions: jest.fn(() => ({}))
}))

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: []
  })
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const mockGetFitnessFile = jest.fn()
jest.mock('@/lib/services/fitness-files', () => ({
  getFitnessFile: (...args: unknown[]) => mockGetFitnessFile(...args)
}))

const mockParseFitnessFile = jest.fn()
jest.mock('@/lib/services/fitness-files/parseFitnessFile', () => ({
  parseFitnessFile: (...args: unknown[]) => mockParseFitnessFile(...args)
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: () => undefined
  })
}))

describe('GET /api/v1/fitness-files/[id]/route-data', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
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

  const createRequest = () =>
    new NextRequest(
      'https://llun.test/api/v1/fitness-files/file-id/route-data',
      {
        method: 'GET'
      }
    )

  const savePrivacyLocation = async (fitnessFileId: string) => {
    await database.updateFitnessFileActivityData(fitnessFileId, {
      privacyHomeLatitude: 37.77,
      privacyHomeLongitude: -122.42,
      privacyHideRadiusMeters: 50
    })
  }

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
      'public, max-age=31536000, immutable'
    )

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
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mockParseFitnessFile).toHaveBeenCalled()
  })

  it('hides home-radius points for non-owner viewers', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })

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
    await savePrivacyLocation(fitnessFile!.id)

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

  it('returns hidden points flagged for the owner account', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

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
    await savePrivacyLocation(fitnessFile!.id)

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

  it('uses file privacy snapshot and ignores later settings updates', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })

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
      id: `${ACTOR1_ID}/statuses/public-route-data-immutable-privacy`,
      url: `${ACTOR1_ID}/statuses/public-route-data-immutable-privacy`,
      actorId: ACTOR1_ID,
      text: 'Public route with immutable privacy snapshot',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR1_FOLLOWER_URL]
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/public-route-data-immutable-privacy.fit',
      fileName: 'public-route-data-immutable-privacy.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })

    await savePrivacyLocation(fitnessFile!.id)

    const initialResponse = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })
    const initialPayload = (await initialResponse.json()) as {
      samples: Array<{ isHiddenByPrivacy: boolean }>
      segments: Array<{ isHiddenByPrivacy: boolean; samples: unknown[] }>
    }

    expect(initialResponse.status).toBe(200)
    expect(initialPayload.samples).toHaveLength(2)
    expect(
      initialPayload.samples.every((sample) => !sample.isHiddenByPrivacy)
    ).toBe(true)

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
    } else {
      await database.createFitnessSettings({
        actorId: ACTOR1_ID,
        serviceType: 'general',
        privacyHomeLatitude: null,
        privacyHomeLongitude: null,
        privacyHideRadiusMeters: 0
      })
    }

    const updatedResponse = await GET(createRequest(), {
      params: Promise.resolve({ id: fitnessFile!.id })
    })
    const updatedPayload = (await updatedResponse.json()) as {
      samples: Array<{ isHiddenByPrivacy: boolean }>
      segments: Array<{ isHiddenByPrivacy: boolean; samples: unknown[] }>
    }

    expect(updatedResponse.status).toBe(200)
    expect(updatedPayload.samples).toHaveLength(2)
    expect(
      updatedPayload.samples.every((sample) => !sample.isHiddenByPrivacy)
    ).toBe(true)
    expect(updatedPayload.segments).toHaveLength(1)
    expect(updatedPayload.segments[0].isHiddenByPrivacy).toBe(false)
    expect(updatedPayload.segments[0].samples).toHaveLength(2)
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
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mockParseFitnessFile).toHaveBeenCalled()
  })
})
