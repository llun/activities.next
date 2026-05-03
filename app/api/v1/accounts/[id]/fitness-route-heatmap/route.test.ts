import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { GET, POST } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockGetActorFromSession = jest.fn()
jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

const mockPublish = jest.fn()
jest.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish })
}))

type MockDatabase = Pick<Database, 'getFitnessRouteHeatmapByKey'>

let mockDatabase: MockDatabase | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('/api/v1/accounts/[id]/fitness-route-heatmap', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessRouteHeatmapByKey: jest.fn()
  }

  const encodedId = ACTOR1_ID.replace('https://', '').replaceAll('/', ':')
  const baseUrl = `http://llun.test/api/v1/accounts/${encodedId}/fitness-route-heatmap`

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockGetActorFromSession.mockResolvedValue({
      ...seedActor1,
      id: ACTOR1_ID
    })
    mockPublish.mockResolvedValue(undefined)
  })

  it('returns route payload for an owner request', async () => {
    const createdTime = Date.now()
    const updatedTime = createdTime + 1000
    mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue({
      id: 'route-heatmap-1',
      actorId: ACTOR1_ID,
      activityType: 'running',
      periodType: 'yearly',
      periodKey: '2026',
      region: '',
      status: 'completed',
      bounds: {
        minLat: 52,
        maxLat: 53,
        minLng: 4,
        maxLng: 5
      },
      segments: [
        {
          points: [
            { lat: 52.1, lng: 4.2 },
            { lat: 52.2, lng: 4.3 }
          ]
        }
      ],
      activityCount: 1,
      pointCount: 2,
      createdAt: createdTime,
      updatedAt: updatedTime
    })

    const request = new NextRequest(
      `${baseUrl}?period_type=yearly&period_key=2026&activity_type=running`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      heatmap: {
        id: 'route-heatmap-1',
        activityType: 'running',
        periodType: 'yearly',
        periodKey: '2026',
        region: '',
        status: 'completed',
        bounds: {
          minLat: 52,
          maxLat: 53,
          minLng: 4,
          maxLng: 5
        },
        segments: [
          {
            points: [
              { lat: 52.1, lng: 4.2 },
              { lat: 52.2, lng: 4.3 }
            ]
          }
        ],
        activityCount: 1,
        pointCount: 2,
        error: null,
        createdAt: createdTime,
        updatedAt: updatedTime
      }
    })
  })

  it('returns a normal empty payload when the cache is missing', async () => {
    mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue(null)

    const request = new NextRequest(
      `${baseUrl}?period_type=yearly&period_key=2026`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      heatmap: null
    })
  })

  it('normalizes multi-region params for lookup', async () => {
    mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue(null)

    const request = new NextRequest(
      `${baseUrl}?period_type=all_time&period_key=all&region=singapore,netherlands,singapore`
    )
    await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(mockDb.getFitnessRouteHeatmapByKey).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      activityType: null,
      periodType: 'all_time',
      periodKey: 'all',
      region: 'netherlands,singapore'
    })
  })

  it('rejects an empty activity type query value', async () => {
    const request = new NextRequest(
      `${baseUrl}?period_type=yearly&period_key=2026&activity_type=`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(400)
    expect(mockDb.getFitnessRouteHeatmapByKey).not.toHaveBeenCalled()
  })

  it('returns 403 for another actor', async () => {
    mockGetActorFromSession.mockResolvedValue({
      ...seedActor1,
      id: 'https://llun.test/users/other'
    })

    const request = new NextRequest(
      `${baseUrl}?period_type=yearly&period_key=2026`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(403)
  })

  it('queues route heatmap generation', async () => {
    const request = new NextRequest(baseUrl, {
      method: 'POST',
      body: JSON.stringify({
        activity_type: 'running',
        period_type: 'monthly',
        period_key: '2026-04',
        region: 'singapore,netherlands'
      })
    })
    const response = await POST(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(202)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: {
          actorId: ACTOR1_ID,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-04',
          region: 'netherlands,singapore'
        }
      })
    )
  })

  it('rejects an empty activity type trigger value', async () => {
    const request = new NextRequest(baseUrl, {
      method: 'POST',
      body: JSON.stringify({
        activity_type: '',
        period_type: 'monthly',
        period_key: '2026-04'
      })
    })
    const response = await POST(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(400)
    expect(mockPublish).not.toHaveBeenCalled()
  })
})
