import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

const mockGetServerSession = jest.fn()
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args)
}))

jest.mock('../../../../auth/[...nextauth]/authOptions', () => ({
  getAuthOptions: jest.fn(() => ({}))
}))

type MockDatabase = Pick<
  Database,
  'getActorFromEmail' | 'getStatus' | 'getFitnessActivityByStatusId'
>

let mockDatabase: MockDatabase | null = null
jest.mock('../../../../../../lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('GET /api/v1/statuses/[id]/activity', () => {
  const statusId = `${ACTOR1_ID}/statuses/fitness-status-1`
  const encodedStatusId = urlToId(statusId)

  const status: Status = {
    id: statusId,
    actorId: ACTOR1_ID,
    actor: null,
    type: StatusType.enum.Note,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    edits: [],
    isLocalActor: true,
    createdAt: Date.now() - 120_000,
    updatedAt: Date.now() - 120_000,
    url: statusId,
    text: 'Morning run summary',
    summary: null,
    reply: '',
    replies: [],
    actorAnnounceStatusId: null,
    isActorLiked: false,
    totalLikes: 0,
    attachments: [],
    tags: []
  }

  const announceStatus: Status = {
    id: `${ACTOR1_ID}/statuses/announce-fitness`,
    actorId: ACTOR1_ID,
    actor: null,
    type: StatusType.enum.Announce,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    edits: [],
    isLocalActor: true,
    createdAt: Date.now() - 80_000,
    updatedAt: Date.now() - 80_000,
    originalStatus: status
  }

  const activity = {
    id: 'fitness-1',
    actorId: ACTOR1_ID,
    stravaActivityId: 123456,
    statusId,
    name: 'Morning Run',
    type: 'Run',
    sportType: 'Run',
    startDate: new Date('2026-02-07T10:00:00.000Z'),
    timezone: '(GMT+09:00) Asia/Tokyo',
    distance: 10000,
    movingTime: 3200,
    elapsedTime: 3450,
    totalElevationGain: 118,
    averageSpeed: 3.125,
    maxSpeed: 5.9,
    averageHeartrate: 151,
    maxHeartrate: 172,
    averageCadence: 83,
    averageWatts: null,
    kilojoules: null,
    calories: 640,
    startLatlng: [35.6762, 139.6503] as [number, number],
    endLatlng: [35.6828, 139.7595] as [number, number],
    summaryPolyline: 'abc123',
    mapAttachmentId: null,
    createdAt: new Date('2026-02-07T10:10:00.000Z'),
    updatedAt: new Date('2026-02-07T10:10:00.000Z')
  }

  const mockDb: jest.Mocked<MockDatabase> = {
    getActorFromEmail: jest.fn(),
    getStatus: jest.fn(),
    getFitnessActivityByStatusId: jest.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    jest.clearAllMocks()

    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    mockDb.getActorFromEmail.mockResolvedValue({
      ...seedActor1,
      id: ACTOR1_ID
    })
    mockDb.getStatus.mockResolvedValue(status)
    mockDb.getFitnessActivityByStatusId.mockResolvedValue(activity)
  })

  it('returns activity data when status has linked fitness activity', async () => {
    const request = new NextRequest(
      `http://llun.test/api/v1/statuses/${encodedStatusId}/activity`,
      { method: 'GET' }
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedStatusId })
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.statusId).toBe(statusId)
    expect(data.activity.stravaActivityId).toBe(123456)
    expect(data.activity.stravaUrl).toBe(
      'https://www.strava.com/activities/123456'
    )
    expect(data.activity.startDate).toBe(activity.startDate.getTime())
    expect(mockDb.getFitnessActivityByStatusId).toHaveBeenCalledWith({
      statusId
    })
  })

  it('resolves announce status to original status activity', async () => {
    mockDb.getStatus.mockResolvedValue(announceStatus)

    const request = new NextRequest(
      `http://llun.test/api/v1/statuses/${encodedStatusId}/activity`,
      { method: 'GET' }
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedStatusId })
    })

    expect(response.status).toBe(200)
    expect(mockDb.getFitnessActivityByStatusId).toHaveBeenCalledWith({
      statusId
    })
  })

  it('returns 404 when the status does not exist', async () => {
    mockDb.getStatus.mockResolvedValue(null)

    const request = new NextRequest(
      `http://llun.test/api/v1/statuses/${encodedStatusId}/activity`,
      { method: 'GET' }
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedStatusId })
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.status).toBe('Not Found')
  })

  it('returns 404 when no fitness activity is linked', async () => {
    mockDb.getFitnessActivityByStatusId.mockResolvedValue(null)

    const request = new NextRequest(
      `http://llun.test/api/v1/statuses/${encodedStatusId}/activity`,
      { method: 'GET' }
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedStatusId })
    })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.status).toBe('Not Found')
  })
})
