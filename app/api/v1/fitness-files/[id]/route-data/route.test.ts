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
      samples: Array<{ elapsedSeconds: number }>
      totalDurationSeconds: number
    }

    expect(payload.totalDurationSeconds).toBe(300)
    expect(payload.samples).toHaveLength(2)
    expect(payload.samples[0].elapsedSeconds).toBe(0)
    expect(payload.samples[1].elapsedSeconds).toBe(300)
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
