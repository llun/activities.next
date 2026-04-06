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

type MockDatabase = Pick<Database, 'getFitnessActivityCalendarData'>

let mockDatabase: MockDatabase | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('GET /api/v1/accounts/[id]/fitness-calendar', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessActivityCalendarData: jest.fn()
  }

  const encodedId = ACTOR1_ID.replace('https://', '').replaceAll('/', ':')
  const baseUrl = `http://llun.test/api/v1/accounts/${encodedId}/fitness-calendar`

  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

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
      `${baseUrl}?start_date=${thirtyDaysAgo}&end_date=${now}`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(401)
  })

  it('returns 401 when session has no actor', async () => {
    mockGetActorFromSession.mockResolvedValue(null)

    const request = new NextRequest(
      `${baseUrl}?start_date=${thirtyDaysAgo}&end_date=${now}`
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
      `${baseUrl}?start_date=${thirtyDaysAgo}&end_date=${now}`
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
    const request = new NextRequest(`${baseUrl}?start_date=${thirtyDaysAgo}`)
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(400)
  })

  it('returns 400 when start_date is not a number', async () => {
    const request = new NextRequest(
      `${baseUrl}?start_date=invalid&end_date=${now}`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(400)
  })

  it('returns 200 with calendar data for valid request', async () => {
    const calendarData = [
      {
        date: '2025-03-15',
        count: 2,
        totalDistanceMeters: 12500,
        totalDurationSeconds: 3600
      },
      {
        date: '2025-03-16',
        count: 1,
        totalDistanceMeters: 5000,
        totalDurationSeconds: 1800
      }
    ]

    mockDb.getFitnessActivityCalendarData.mockResolvedValue(calendarData)

    const request = new NextRequest(
      `${baseUrl}?start_date=${thirtyDaysAgo}&end_date=${now}`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual(calendarData)

    expect(mockDb.getFitnessActivityCalendarData).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      startDate: thirtyDaysAgo,
      endDate: now,
      activityType: undefined
    })
  })

  it('passes activity_type filter to database', async () => {
    mockDb.getFitnessActivityCalendarData.mockResolvedValue([])

    const request = new NextRequest(
      `${baseUrl}?start_date=${thirtyDaysAgo}&end_date=${now}&activity_type=running`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)

    expect(mockDb.getFitnessActivityCalendarData).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      startDate: thirtyDaysAgo,
      endDate: now,
      activityType: 'running'
    })
  })

  it('returns 200 with empty array when no activities', async () => {
    mockDb.getFitnessActivityCalendarData.mockResolvedValue([])

    const request = new NextRequest(
      `${baseUrl}?start_date=${thirtyDaysAgo}&end_date=${now}`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual([])
  })

  it('returns 500 when database is not available', async () => {
    mockDatabase = null

    const request = new NextRequest(
      `${baseUrl}?start_date=${thirtyDaysAgo}&end_date=${now}`
    )
    const response = await GET(request, {
      params: Promise.resolve({ id: encodedId })
    })
    expect(response.status).toBe(500)

    mockDatabase = mockDb
  })
})
