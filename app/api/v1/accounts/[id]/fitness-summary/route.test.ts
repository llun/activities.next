import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { logger } from '@/lib/utils/logger'

import { GET, OPTIONS } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockGetActorFromSession = vi.fn()
vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

type MockDatabase = Pick<
  Database,
  'getFitnessActivitySummary' | 'getActorIdByPublicId'
>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const ORIGIN = 'https://client.example'

describe('GET /api/v1/accounts/[id]/fitness-summary', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessActivitySummary: vi.fn(),
    getActorIdByPublicId: vi.fn()
  }

  const encodedId = ACTOR1_ID.replace('https://', '').replaceAll('/', ':')
  const baseUrl = `http://llun.test/api/v1/accounts/${encodedId}/fitness-summary`
  const validQuery = 'from=2026-01-01&to=2026-10-04&time_zone=Europe/Amsterdam'

  const callGet = (query: string, id = encodedId) =>
    GET(
      new NextRequest(`${baseUrl}?${query}`, { headers: { Origin: ORIGIN } }),
      {
        params: Promise.resolve({ id })
      }
    )

  const expectCorsError = async (response: Response, status: number) => {
    expect(response.status).toBe(status)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    const body = await response.json()
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase = mockDb
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockGetActorFromSession.mockResolvedValue({
      ...seedActor1,
      id: ACTOR1_ID
    })
  })

  it('answers the CORS preflight', async () => {
    const response = await OPTIONS(
      new NextRequest(baseUrl, {
        method: 'OPTIONS',
        headers: { Origin: ORIGIN }
      })
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
      'OPTIONS,GET'
    )
  })

  it('returns 401 when not logged in', async () => {
    mockGetServerSession.mockResolvedValue(null)
    await expectCorsError(await callGet(validQuery), 401)
    expect(mockDb.getFitnessActivitySummary).not.toHaveBeenCalled()
  })

  it('returns 401 when the session has no actor', async () => {
    mockGetActorFromSession.mockResolvedValue(null)
    await expectCorsError(await callGet(validQuery), 401)
    expect(mockDb.getFitnessActivitySummary).not.toHaveBeenCalled()
  })

  it("returns 403 for another actor's summary", async () => {
    mockGetActorFromSession.mockResolvedValue({
      ...seedActor1,
      id: 'https://llun.test/users/other'
    })
    await expectCorsError(await callGet(validQuery), 403)
    expect(mockDb.getFitnessActivitySummary).not.toHaveBeenCalled()
  })

  it('returns 403 for an account publicId that resolves to another actor', async () => {
    mockDb.getActorIdByPublicId.mockResolvedValue(
      'https://llun.test/users/other'
    )
    await expectCorsError(
      await callGet(validQuery, '0190d8a6-7a3e-7cc1-8f2a-0123456789ab'),
      403
    )
    expect(mockDb.getActorIdByPublicId).toHaveBeenCalled()
    expect(mockDb.getFitnessActivitySummary).not.toHaveBeenCalled()
  })

  it("accepts the signed-in actor's own publicId", async () => {
    mockDb.getActorIdByPublicId.mockResolvedValue(ACTOR1_ID)
    mockDb.getFitnessActivitySummary.mockResolvedValue([])
    const response = await callGet(
      validQuery,
      '0190d8a6-7a3e-7cc1-8f2a-0123456789ab'
    )
    expect(response.status).toBe(200)
    expect(mockDb.getFitnessActivitySummary).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ACTOR1_ID })
    )
  })

  it('returns 500 with CORS headers when the database is not available', async () => {
    mockDatabase = null
    await expectCorsError(await callGet(validQuery), 500)
  })

  it.each([
    ['the old instant params', 'start_date=1&end_date=2'],
    ['a missing time_zone', 'from=2026-01-01&to=2026-10-04'],
    ['an offset time_zone', 'from=2026-01-01&to=2026-10-04&time_zone=%2B05:30'],
    [
      'an unknown time_zone',
      'from=2026-01-01&to=2026-10-04&time_zone=Not/AZone'
    ],
    [
      'an over-long time_zone',
      `from=2026-01-01&to=2026-10-04&time_zone=A${'a'.repeat(64)}`
    ],
    ['an impossible date', 'from=2026-02-30&to=2026-10-04&time_zone=UTC'],
    ['a malformed date', 'from=2026/01/01&to=2026-10-04&time_zone=UTC'],
    ['an inverted range', 'from=2026-10-05&to=2026-10-04&time_zone=UTC']
  ])('returns 400 with CORS headers for %s', async (_label, query) => {
    await expectCorsError(await callGet(query), 400)
    expect(mockDb.getFitnessActivitySummary).not.toHaveBeenCalled()
  })

  it('accepts a one-day range, so This month loads on the 1st', async () => {
    mockDb.getFitnessActivitySummary.mockResolvedValue([])
    const response = await callGet(
      'from=2026-10-01&to=2026-10-01&time_zone=UTC'
    )
    expect(response.status).toBe(200)
    expect(mockDb.getFitnessActivitySummary).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      startDate: Date.UTC(2026, 9, 1),
      endDate: Date.UTC(2026, 9, 2)
    })
  })

  it("queries the signed-in actor's local-day window and returns the groups, untyped included", async () => {
    const summary = [
      {
        activityType: 'running',
        count: 3,
        totalDistanceMeters: 30000,
        totalDurationSeconds: 9000,
        totalElevationGainMeters: 120
      },
      {
        activityType: null,
        count: 1,
        totalDistanceMeters: 0,
        totalDurationSeconds: 1800,
        totalElevationGainMeters: 0
      }
    ]
    mockDb.getFitnessActivitySummary.mockResolvedValue(summary)

    const response = await callGet(
      'from=2026-01-01&to=2026-10-04&time_zone=europe/amsterdam'
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(summary)
    expect(mockDb.getFitnessActivitySummary).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      // 1 Jan 00:00 CET through the end of 4 Oct CEST.
      startDate: Date.UTC(2025, 11, 31, 23),
      endDate: Date.UTC(2026, 9, 4, 22)
    })
  })

  it('returns 500 with CORS headers when the query fails', async () => {
    const errorSpy = vi.spyOn(logger, 'error')
    mockDb.getFitnessActivitySummary.mockRejectedValue(new Error('db down'))
    await expectCorsError(await callGet(validQuery), 500)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) })
    )
    errorSpy.mockRestore()
  })
})
