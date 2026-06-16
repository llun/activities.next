import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { GET } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockGetActorFromSession = vi.fn()
vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

type MockDatabase = Pick<Database, 'getFitnessRouteHeatmapSummariesForActor'>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('/api/v1/accounts/[id]/fitness-heatmaps legacy adapter', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessRouteHeatmapSummariesForActor: vi.fn()
  }

  const encodedId = ACTOR1_ID.replace('https://', '').replaceAll('/', ':')
  const baseUrl = `http://llun.test/api/v1/accounts/${encodedId}/fitness-heatmaps`

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
    mockDb.getFitnessRouteHeatmapSummariesForActor.mockResolvedValue([])
  })

  it('adapts route cache summaries to legacy heatmap history payloads', async () => {
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
      }
    ])

    const response = await GET(new NextRequest(baseUrl), {
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
          imagePath: null,
          activityCount: 1,
          error: null,
          createdAt: createdTime,
          updatedAt: updatedTime
        }
      ]
    })
  })
})
