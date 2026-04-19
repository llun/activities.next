import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { GET } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockGetActorFromSession = jest.fn()
jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

type MockDatabase = Pick<Database, 'getFitnessHeatmapsForActor'>

let mockDatabase: MockDatabase | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('GET /api/v1/accounts/[id]/fitness-heatmaps', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessHeatmapsForActor: jest.fn()
  }

  const encodedId = ACTOR1_ID.replace('https://', '').replaceAll('/', ':')
  const baseUrl = `http://llun.test/api/v1/accounts/${encodedId}/fitness-heatmaps`

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
    mockDb.getFitnessHeatmapsForActor.mockResolvedValue([])
  })

  it('returns 401 when not logged in', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const request = new NextRequest(baseUrl)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(401)
  })

  it('returns 401 when session has no actor', async () => {
    mockGetActorFromSession.mockResolvedValue(null)

    const request = new NextRequest(baseUrl)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(401)
  })

  it('returns 403 when requesting another actors data', async () => {
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

  it('returns 200 with empty heatmaps array', async () => {
    mockDb.getFitnessHeatmapsForActor.mockResolvedValue([])

    const request = new NextRequest(baseUrl)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({ heatmaps: [] })
  })

  it('returns 200 with full heatmap list including error field', async () => {
    const createdTime = Date.now()
    const updatedTime = Date.now() + 1000

    const heatmaps = [
      {
        id: 'heatmap-1',
        actorId: ACTOR1_ID,
        activityType: 'running',
        periodType: 'yearly' as const,
        periodKey: '2025',
        region: '',
        status: 'completed' as const,
        imagePath: 'heatmaps/actor1/yearly_2025.png',
        activityCount: 42,
        error: null,
        createdAt: createdTime,
        updatedAt: updatedTime
      },
      {
        id: 'heatmap-2',
        actorId: ACTOR1_ID,
        activityType: 'cycling',
        periodType: 'monthly' as const,
        periodKey: '2025-03',
        region: 'netherlands',
        status: 'failed' as const,
        imagePath: null,
        activityCount: 0,
        error: 'boom',
        createdAt: createdTime,
        updatedAt: updatedTime
      }
    ]

    mockDb.getFitnessHeatmapsForActor.mockResolvedValue(heatmaps)

    const request = new NextRequest(baseUrl)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({
      heatmaps: [
        {
          id: 'heatmap-1',
          activityType: 'running',
          periodType: 'yearly',
          periodKey: '2025',
          region: '',
          status: 'completed',
          imagePath: 'heatmaps/actor1/yearly_2025.png',
          activityCount: 42,
          error: null,
          createdAt: createdTime,
          updatedAt: updatedTime
        },
        {
          id: 'heatmap-2',
          activityType: 'cycling',
          periodType: 'monthly',
          periodKey: '2025-03',
          region: 'netherlands',
          status: 'failed',
          imagePath: null,
          activityCount: 0,
          error: 'boom',
          createdAt: createdTime,
          updatedAt: updatedTime
        }
      ]
    })

    expect(mockDb.getFitnessHeatmapsForActor).toHaveBeenCalledWith({
      actorId: ACTOR1_ID
    })
  })

  it('returns 500 when database is not available', async () => {
    mockDatabase = null

    const request = new NextRequest(baseUrl)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(500)

    mockDatabase = mockDb
  })
})
