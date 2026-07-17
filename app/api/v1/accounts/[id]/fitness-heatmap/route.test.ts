import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { GET, POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockGetActorFromSession = vi.fn()
vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

const mockPublish = vi.fn()
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish })
}))

type MockDatabase = Pick<Database, 'getFitnessRouteHeatmapByKey'>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('/api/v1/accounts/[id]/fitness-heatmap legacy adapter', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessRouteHeatmapByKey: vi.fn()
  }

  const encodedId = ACTOR1_ID.replace('https://', '').replaceAll('/', ':')
  const baseUrl = `http://llun.test/api/v1/accounts/${encodedId}/fitness-heatmap`

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
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

  it('returns a legacy 404 when the route cache is missing', async () => {
    const request = new NextRequest(
      `${baseUrl}?period_type=yearly&period_key=2026`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not Found' })
  })

  it('adapts route cache data to the legacy flat heatmap payload', async () => {
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
      segments: [],
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
      id: 'route-heatmap-1',
      activityType: 'running',
      periodType: 'yearly',
      periodKey: '2026',
      region: '',
      status: 'completed',
      imagePath: null,
      activityCount: 1,
      error: null,
      createdAt: createdTime,
      updatedAt: updatedTime
    })
  })

  it('keeps POST available for legacy refresh callers', async () => {
    const request = new NextRequest(baseUrl, {
      method: 'POST',
      headers: { Origin: 'https://test.llun.dev' },
      body: JSON.stringify({
        activity_type: 'running',
        period_type: 'yearly',
        period_key: '2026'
      })
    })
    const response = await POST(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(202)
    expect(mockPublish).toHaveBeenCalled()
  })
})
