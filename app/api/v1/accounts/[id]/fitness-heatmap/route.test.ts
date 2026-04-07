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

type MockDatabase = Pick<Database, 'getFitnessHeatmapByKey'>

let mockDatabase: MockDatabase | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('GET /api/v1/accounts/[id]/fitness-heatmap', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessHeatmapByKey: jest.fn()
  }

  const encodedId = ACTOR1_ID.replace('https://', '').replaceAll('/', ':')
  const baseUrl = `http://llun.test/api/v1/accounts/${encodedId}/fitness-heatmap`

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
  })

  it('returns 401 when not logged in', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const request = new NextRequest(
      `${baseUrl}?period_type=yearly&period_key=2025`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(401)
  })

  it('returns 401 when session has no actor', async () => {
    mockGetActorFromSession.mockResolvedValue(null)

    const request = new NextRequest(
      `${baseUrl}?period_type=yearly&period_key=2025`
    )
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

    const request = new NextRequest(
      `${baseUrl}?period_type=yearly&period_key=2025`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(403)
  })

  it('returns 400 when period_type is missing', async () => {
    const request = new NextRequest(`${baseUrl}?period_key=2025`)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(400)
  })

  it('returns 400 when period_key is missing', async () => {
    const request = new NextRequest(`${baseUrl}?period_type=yearly`)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(400)
  })

  it('returns 400 when period_type is invalid', async () => {
    const request = new NextRequest(
      `${baseUrl}?period_type=weekly&period_key=2025`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(400)
  })

  it('returns 404 when heatmap is not found', async () => {
    mockDb.getFitnessHeatmapByKey.mockResolvedValue(null)

    const request = new NextRequest(
      `${baseUrl}?period_type=yearly&period_key=2025`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(404)
  })

  it('returns 200 with heatmap data for valid request', async () => {
    const heatmapData = {
      id: 'heatmap-1',
      actorId: ACTOR1_ID,
      activityType: 'running',
      periodType: 'yearly' as const,
      periodKey: '2025',
      status: 'completed' as const,
      imagePath: 'heatmaps/actor1/yearly_2025.png',
      activityCount: 42,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    mockDb.getFitnessHeatmapByKey.mockResolvedValue(heatmapData)

    const request = new NextRequest(
      `${baseUrl}?period_type=yearly&period_key=2025&activity_type=running`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({
      id: 'heatmap-1',
      activityType: 'running',
      periodType: 'yearly',
      periodKey: '2025',
      status: 'completed',
      imagePath: 'heatmaps/actor1/yearly_2025.png',
      activityCount: 42
    })

    expect(mockDb.getFitnessHeatmapByKey).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      activityType: 'running',
      periodType: 'yearly',
      periodKey: '2025',
      regions: ''
    })
  })

  it('returns heatmap without activityType when not specified', async () => {
    const heatmapData = {
      id: 'heatmap-2',
      actorId: ACTOR1_ID,
      periodType: 'all_time' as const,
      periodKey: 'all',
      status: 'completed' as const,
      imagePath: 'heatmaps/actor1/all_time_all.png',
      activityCount: 100,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    mockDb.getFitnessHeatmapByKey.mockResolvedValue(heatmapData)

    const request = new NextRequest(
      `${baseUrl}?period_type=all_time&period_key=all`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.activityType).toBeUndefined()

    expect(mockDb.getFitnessHeatmapByKey).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      activityType: null,
      periodType: 'all_time',
      periodKey: 'all',
      regions: ''
    })
  })

  it('returns 500 when database is not available', async () => {
    mockDatabase = null

    const request = new NextRequest(
      `${baseUrl}?period_type=yearly&period_key=2025`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(500)

    mockDatabase = mockDb
  })
})
