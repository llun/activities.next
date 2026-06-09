import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { getHashFromString } from '@/lib/utils/getHashFromString'

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
    mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue(null)
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
      cursorOffset: 0,
      isPartial: false,
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
        cursorOffset: 0,
        isPartial: false,
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

  it('normalizes an empty activity type query value to all activities', async () => {
    mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue(null)

    const request = new NextRequest(
      `${baseUrl}?period_type=yearly&period_key=2026&activity_type=`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    expect(mockDb.getFitnessRouteHeatmapByKey).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      activityType: null,
      periodType: 'yearly',
      periodKey: '2026',
      region: ''
    })
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
      headers: { Origin: 'https://test.llun.dev' },
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
        data: expect.objectContaining({
          actorId: ACTOR1_ID,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-04',
          region: 'netherlands,singapore',
          requestedAt: expect.any(Number)
        })
      })
    )
  })

  it('versions the job id when restoring a cleared route heatmap cache', async () => {
    const deletedAt = Date.now() - 1000
    mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue({
      id: 'route-heatmap-deleted',
      actorId: ACTOR1_ID,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-04',
      region: 'netherlands',
      status: 'completed',
      segments: [],
      activityCount: 8,
      pointCount: 200,
      cursorOffset: 0,
      isPartial: false,
      createdAt: deletedAt - 1000,
      updatedAt: deletedAt,
      deletedAt
    })

    const request = new NextRequest(baseUrl, {
      method: 'POST',
      headers: { Origin: 'https://test.llun.dev' },
      body: JSON.stringify({
        activity_type: 'running',
        period_type: 'monthly',
        period_key: '2026-04',
        region: 'netherlands'
      })
    })
    const response = await POST(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(202)
    expect(mockDb.getFitnessRouteHeatmapByKey).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-04',
      region: 'netherlands',
      includeDeleted: true
    })
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        id: getHashFromString(
          `${ACTOR1_ID}:route-heatmap:running:monthly:2026-04:netherlands:restore:route-heatmap-deleted:${deletedAt}`
        ),
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: expect.objectContaining({
          actorId: ACTOR1_ID,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-04',
          region: 'netherlands',
          requestedAt: expect.any(Number)
        })
      })
    )
  })

  it('uses a unique retry job id for existing non-resumable caches', async () => {
    const retryNonce = '00000000-0000-4000-8000-000000000000'
    const randomUUIDSpy = jest
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue(retryNonce)
    const updatedTime = Date.now()
    mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue({
      id: 'route-heatmap-failed-zero',
      actorId: ACTOR1_ID,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-04',
      region: 'netherlands',
      status: 'failed',
      segments: [],
      activityCount: 0,
      pointCount: 0,
      cursorOffset: 0,
      isPartial: false,
      error: 'failed before checkpoint',
      createdAt: updatedTime - 1000,
      updatedAt: updatedTime
    })

    try {
      const request = new NextRequest(baseUrl, {
        method: 'POST',
        headers: { Origin: 'https://test.llun.dev' },
        body: JSON.stringify({
          activity_type: 'running',
          period_type: 'monthly',
          period_key: '2026-04',
          region: 'netherlands',
          retry: true
        })
      })
      const response = await POST(request, {
        params: Promise.resolve({ id: encodedId })
      })

      expect(response.status).toBe(202)
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          id: getHashFromString(
            `${ACTOR1_ID}:route-heatmap:running:monthly:2026-04:netherlands:retry:route-heatmap-failed-zero:${retryNonce}`
          ),
          name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
          data: expect.objectContaining({
            actorId: ACTOR1_ID,
            activityType: 'running',
            periodType: 'monthly',
            periodKey: '2026-04',
            region: 'netherlands',
            requestedAt: expect.any(Number)
          })
        })
      )
    } finally {
      randomUUIDSpy.mockRestore()
    }
  })

  it('keeps the deterministic job id for non-retry refreshes of existing caches', async () => {
    const randomUUIDSpy = jest.spyOn(crypto, 'randomUUID')
    const updatedTime = Date.now()
    mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue({
      id: 'route-heatmap-completed',
      actorId: ACTOR1_ID,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-04',
      region: 'netherlands',
      status: 'completed',
      segments: [],
      activityCount: 8,
      pointCount: 200,
      cursorOffset: 0,
      isPartial: false,
      createdAt: updatedTime - 1000,
      updatedAt: updatedTime
    })

    try {
      const request = new NextRequest(baseUrl, {
        method: 'POST',
        headers: { Origin: 'https://test.llun.dev' },
        body: JSON.stringify({
          activity_type: 'running',
          period_type: 'monthly',
          period_key: '2026-04',
          region: 'netherlands'
        })
      })
      const response = await POST(request, {
        params: Promise.resolve({ id: encodedId })
      })

      expect(response.status).toBe(202)
      expect(randomUUIDSpy).not.toHaveBeenCalled()
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          id: getHashFromString(
            `${ACTOR1_ID}:route-heatmap:running:monthly:2026-04:netherlands`
          ),
          name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
          data: expect.objectContaining({
            actorId: ACTOR1_ID,
            activityType: 'running',
            periodType: 'monthly',
            periodKey: '2026-04',
            region: 'netherlands',
            requestedAt: expect.any(Number)
          })
        })
      )
    } finally {
      randomUUIDSpy.mockRestore()
    }
  })

  it('resumes failed route heatmap generation from a persisted cursor', async () => {
    const updatedTime = Date.now()
    mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue({
      id: 'route-heatmap-failed',
      actorId: ACTOR1_ID,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-04',
      region: 'netherlands',
      status: 'failed',
      segments: [],
      activityCount: 20,
      pointCount: 100,
      cursorOffset: 500,
      isPartial: false,
      error: 'temporary queue failure',
      createdAt: updatedTime - 1000,
      updatedAt: updatedTime
    })

    const request = new NextRequest(baseUrl, {
      method: 'POST',
      headers: { Origin: 'https://test.llun.dev' },
      body: JSON.stringify({
        activity_type: 'running',
        period_type: 'monthly',
        period_key: '2026-04',
        region: 'netherlands'
      })
    })
    const response = await POST(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(202)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        id: getHashFromString(
          `${ACTOR1_ID}:route-heatmap:running:monthly:2026-04:netherlands:resume:route-heatmap-failed:500`
        ),
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: expect.objectContaining({
          actorId: ACTOR1_ID,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-04',
          region: 'netherlands',
          resume: true,
          cursorOffset: 500,
          requestedAt: expect.any(Number)
        })
      })
    )
  })

  it('resumes partial completed route heatmap generation from the capped cursor', async () => {
    const updatedTime = Date.now()
    mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue({
      id: 'route-heatmap-partial',
      actorId: ACTOR1_ID,
      activityType: 'running',
      periodType: 'monthly',
      periodKey: '2026-04',
      region: 'netherlands',
      status: 'completed',
      segments: [],
      activityCount: 20,
      pointCount: 100,
      cursorOffset: 1_000_000,
      isPartial: true,
      createdAt: updatedTime - 1000,
      updatedAt: updatedTime
    })

    const request = new NextRequest(baseUrl, {
      method: 'POST',
      headers: { Origin: 'https://test.llun.dev' },
      body: JSON.stringify({
        activity_type: 'running',
        period_type: 'monthly',
        period_key: '2026-04',
        region: 'netherlands'
      })
    })
    const response = await POST(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(202)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        id: getHashFromString(
          `${ACTOR1_ID}:route-heatmap:running:monthly:2026-04:netherlands:resume:route-heatmap-partial:1000000`
        ),
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: expect.objectContaining({
          actorId: ACTOR1_ID,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-04',
          region: 'netherlands',
          resume: true,
          cursorOffset: 1_000_000,
          requestedAt: expect.any(Number)
        })
      })
    )
  })

  it('normalizes an empty activity type trigger value to all activities', async () => {
    const request = new NextRequest(baseUrl, {
      method: 'POST',
      headers: { Origin: 'https://test.llun.dev' },
      body: JSON.stringify({
        activity_type: '',
        period_type: 'monthly',
        period_key: '2026-04'
      })
    })
    const response = await POST(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(202)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
        data: expect.objectContaining({
          actorId: ACTOR1_ID,
          activityType: null,
          periodType: 'monthly',
          periodKey: '2026-04',
          region: '',
          requestedAt: expect.any(Number)
        })
      })
    )
  })
})
