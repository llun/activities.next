import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { DELETE, GET } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockGetActorFromSession = jest.fn()
jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

type MockDatabase = Pick<
  Database,
  | 'deleteFitnessRouteHeatmapsForActor'
  | 'getFitnessRouteHeatmapSummariesForActor'
>

let mockDatabase: MockDatabase | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('GET /api/v1/accounts/[id]/fitness-route-heatmaps', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    deleteFitnessRouteHeatmapsForActor: jest.fn(),
    getFitnessRouteHeatmapSummariesForActor: jest.fn()
  }

  const encodedId = ACTOR1_ID.replace('https://', '').replaceAll('/', ':')
  const baseUrl = `http://llun.test/api/v1/accounts/${encodedId}/fitness-route-heatmaps`

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
    mockDb.getFitnessRouteHeatmapSummariesForActor.mockResolvedValue([])
    mockDb.deleteFitnessRouteHeatmapsForActor.mockResolvedValue(0)
  })

  it('returns owner route heatmap history', async () => {
    const createdTime = Date.now()
    const updatedTime = createdTime + 1000

    mockDb.getFitnessRouteHeatmapSummariesForActor.mockResolvedValue([
      {
        id: 'route-heatmap-1',
        actorId: ACTOR1_ID,
        activityType: 'running',
        periodType: 'yearly',
        periodKey: '2026',
        region: '',
        status: 'completed',
        activityCount: 1,
        pointCount: 2,
        cursorOffset: 0,
        isPartial: false,
        createdAt: createdTime,
        updatedAt: updatedTime
      },
      {
        id: 'route-heatmap-2',
        actorId: ACTOR1_ID,
        periodType: 'monthly',
        periodKey: '2026-04',
        region: 'netherlands',
        status: 'failed',
        activityCount: 0,
        pointCount: 0,
        cursorOffset: 250,
        isPartial: false,
        error: 'parse failed',
        createdAt: createdTime,
        updatedAt: updatedTime
      }
    ])

    const request = new NextRequest(baseUrl)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      heatmaps: [
        {
          id: 'route-heatmap-1',
          activityType: 'running',
          periodType: 'yearly',
          periodKey: '2026',
          region: '',
          status: 'completed',
          activityCount: 1,
          pointCount: 2,
          cursorOffset: 0,
          isPartial: false,
          error: null,
          createdAt: createdTime,
          updatedAt: updatedTime
        },
        {
          id: 'route-heatmap-2',
          periodType: 'monthly',
          periodKey: '2026-04',
          region: 'netherlands',
          status: 'failed',
          activityCount: 0,
          pointCount: 0,
          cursorOffset: 250,
          isPartial: false,
          error: 'parse failed',
          createdAt: createdTime,
          updatedAt: updatedTime
        }
      ]
    })
  })

  it('returns 403 for another actor', async () => {
    mockGetActorFromSession.mockResolvedValue({
      ...seedActor1,
      id: 'https://llun.test/users/other'
    })

    const request = new NextRequest(baseUrl)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(403)
  })

  it('clears owner route heatmap history', async () => {
    mockDb.deleteFitnessRouteHeatmapsForActor.mockResolvedValue(3)

    const request = new NextRequest(baseUrl, {
      method: 'DELETE',
      headers: { Origin: 'https://test.llun.dev' }
    })
    const response = await DELETE(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    expect(mockDb.deleteFitnessRouteHeatmapsForActor).toHaveBeenCalledWith({
      actorId: ACTOR1_ID
    })
    await expect(response.json()).resolves.toEqual({ deleted: 3 })
  })

  it('does not clear route heatmap history for another actor', async () => {
    mockGetActorFromSession.mockResolvedValue({
      ...seedActor1,
      id: 'https://llun.test/users/other'
    })

    const request = new NextRequest(baseUrl, {
      method: 'DELETE',
      headers: { Origin: 'https://test.llun.dev' }
    })
    const response = await DELETE(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(403)
    expect(mockDb.deleteFitnessRouteHeatmapsForActor).not.toHaveBeenCalled()
  })
})
