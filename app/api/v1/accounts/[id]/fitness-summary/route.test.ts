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

type MockDatabase = Pick<Database, 'getFitnessActivitySummary'>

let mockDatabase: MockDatabase | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('GET /api/v1/accounts/[id]/fitness-summary', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessActivitySummary: jest.fn()
  }

  const encodedId = ACTOR1_ID.replace('https://', '').replaceAll('/', ':')
  const baseUrl = `http://llun.test/api/v1/accounts/${encodedId}/fitness-summary`

  const now = Date.now()
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

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
      `${baseUrl}?start_date=${sevenDaysAgo}&end_date=${now}`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(401)
  })

  it('returns 401 when session has no actor', async () => {
    mockGetActorFromSession.mockResolvedValue(null)

    const request = new NextRequest(
      `${baseUrl}?start_date=${sevenDaysAgo}&end_date=${now}`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(401)
  })

  it('returns 403 when requesting another actors fitness data', async () => {
    mockGetActorFromSession.mockResolvedValue({
      ...seedActor1,
      id: 'https://llun.test/users/other'
    })

    const request = new NextRequest(
      `${baseUrl}?start_date=${sevenDaysAgo}&end_date=${now}`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(403)
  })

  it('returns 400 when start_date is missing', async () => {
    const request = new NextRequest(`${baseUrl}?end_date=${now}`)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(400)
  })

  it('returns 400 when end_date is missing', async () => {
    const request = new NextRequest(`${baseUrl}?start_date=${sevenDaysAgo}`)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(400)
  })

  it('returns 400 when date range is less than 7 days', async () => {
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000
    const request = new NextRequest(
      `${baseUrl}?start_date=${threeDaysAgo}&end_date=${now}`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(400)
  })

  it('returns 200 with summary data for valid request', async () => {
    const summaryData = [
      {
        activityType: 'running',
        count: 5,
        totalDistanceMeters: 25000,
        totalDurationSeconds: 7200,
        totalElevationGainMeters: 300
      },
      {
        activityType: 'cycling',
        count: 3,
        totalDistanceMeters: 60000,
        totalDurationSeconds: 10800,
        totalElevationGainMeters: 500
      }
    ]

    mockDb.getFitnessActivitySummary.mockResolvedValue(summaryData)

    const request = new NextRequest(
      `${baseUrl}?start_date=${sevenDaysAgo}&end_date=${now}`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual(summaryData)

    expect(mockDb.getFitnessActivitySummary).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      startDate: sevenDaysAgo,
      endDate: now
    })
  })

  it('returns 500 when database is not available', async () => {
    mockDatabase = null

    const request = new NextRequest(
      `${baseUrl}?start_date=${sevenDaysAgo}&end_date=${now}`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(500)

    mockDatabase = mockDb
  })
})
