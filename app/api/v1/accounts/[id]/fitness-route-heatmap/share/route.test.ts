import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { DELETE, POST } from './route'

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
  | 'getFitnessRouteHeatmapByKey'
  | 'getFitnessRouteHeatmap'
  | 'setFitnessRouteHeatmapShareToken'
  | 'clearFitnessRouteHeatmapShareToken'
>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const completedHeatmap = (overrides: Record<string, unknown> = {}) => ({
  id: 'route-heatmap-share',
  actorId: ACTOR1_ID,
  activityType: undefined,
  periodType: 'all_time' as const,
  periodKey: 'all',
  region: '',
  status: 'completed' as const,
  segments: [],
  activityCount: 1,
  pointCount: 2,
  totalCount: 2,
  cursorOffset: 0,
  isPartial: false,
  shareToken: null,
  createdAt: Date.now() - 1000,
  updatedAt: Date.now(),
  ...overrides
})

describe('/api/v1/accounts/[id]/fitness-route-heatmap/share', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessRouteHeatmapByKey: vi.fn(),
    getFitnessRouteHeatmap: vi.fn(),
    setFitnessRouteHeatmapShareToken: vi.fn(),
    clearFitnessRouteHeatmapShareToken: vi.fn()
  }

  const encodedId = ACTOR1_ID.replace('https://', '').replaceAll('/', ':')
  const baseUrl = `http://llun.test/api/v1/accounts/${encodedId}/fitness-route-heatmap/share`

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockGetActorFromSession.mockResolvedValue({ ...seedActor1, id: ACTOR1_ID })
    mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue(null)
    mockDb.getFitnessRouteHeatmap.mockResolvedValue(
      completedHeatmap({ shareToken: 'persisted-token' })
    )
    mockDb.setFitnessRouteHeatmapShareToken.mockResolvedValue(true)
    mockDb.clearFitnessRouteHeatmapShareToken.mockResolvedValue(true)
  })

  const postRequest = (body: Record<string, unknown>) =>
    new NextRequest(baseUrl, {
      method: 'POST',
      headers: { Origin: 'https://test.llun.dev' },
      body: JSON.stringify(body)
    })

  it('mints a share token for the owner', async () => {
    mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue(completedHeatmap())

    const response = await POST(
      postRequest({ period_type: 'all_time', period_key: 'all' }),
      { params: Promise.resolve({ id: encodedId }) }
    )

    expect(response.status).toBe(200)
    // The response token is whatever is actually stored after the conditional
    // set (read back from the row), not the locally generated value.
    await expect(response.json()).resolves.toEqual({
      shareToken: 'persisted-token'
    })
    expect(mockDb.setFitnessRouteHeatmapShareToken).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      id: 'route-heatmap-share',
      shareToken: expect.any(String)
    })
  })

  it('returns the winner token when a concurrent request already shared it', async () => {
    mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue(completedHeatmap())
    // This caller loses the conditional (shareToken IS NULL) update...
    mockDb.setFitnessRouteHeatmapShareToken.mockResolvedValue(false)
    // ...but the row now holds the winning request's token.
    mockDb.getFitnessRouteHeatmap.mockResolvedValue(
      completedHeatmap({ shareToken: 'winner-token' })
    )

    const response = await POST(
      postRequest({ period_type: 'all_time', period_key: 'all' }),
      { params: Promise.resolve({ id: encodedId }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      shareToken: 'winner-token'
    })
  })

  it('is idempotent and reuses an existing token', async () => {
    mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue(
      completedHeatmap({ shareToken: 'existing-token' })
    )

    const response = await POST(
      postRequest({ period_type: 'all_time', period_key: 'all' }),
      { params: Promise.resolve({ id: encodedId }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      shareToken: 'existing-token'
    })
    expect(mockDb.setFitnessRouteHeatmapShareToken).not.toHaveBeenCalled()
  })

  it('returns 404 when the heatmap does not exist', async () => {
    mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue(null)

    const response = await POST(
      postRequest({ period_type: 'all_time', period_key: 'all' }),
      { params: Promise.resolve({ id: encodedId }) }
    )

    expect(response.status).toBe(404)
    expect(mockDb.setFitnessRouteHeatmapShareToken).not.toHaveBeenCalled()
  })

  it('refuses to share a heatmap that is not completed', async () => {
    mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue(
      completedHeatmap({ status: 'generating' })
    )

    const response = await POST(
      postRequest({ period_type: 'all_time', period_key: 'all' }),
      { params: Promise.resolve({ id: encodedId }) }
    )

    expect(response.status).toBe(409)
    expect(mockDb.setFitnessRouteHeatmapShareToken).not.toHaveBeenCalled()
  })

  it.each([
    { activityType: 'running', periodType: 'all_time', periodKey: 'all' },
    { activityType: undefined, periodType: 'yearly', periodKey: '2026' }
  ])(
    'refuses to mint a share for a filtered heatmap that the page cannot unshare ($periodType/$activityType)',
    async (scope) => {
      mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue(
        completedHeatmap(scope)
      )

      const response = await POST(
        postRequest({
          period_type: scope.periodType,
          period_key: scope.periodKey,
          ...(scope.activityType ? { activity_type: scope.activityType } : {})
        }),
        { params: Promise.resolve({ id: encodedId }) }
      )

      expect(response.status).toBe(400)
      expect(mockDb.setFitnessRouteHeatmapShareToken).not.toHaveBeenCalled()
    }
  )

  it('rejects a cross-site POST without same-origin proof', async () => {
    const request = new NextRequest(baseUrl, {
      method: 'POST',
      body: JSON.stringify({ period_type: 'all_time', period_key: 'all' })
    })
    const response = await POST(request, {
      params: Promise.resolve({ id: encodedId })
    })

    expect(response.status).toBe(403)
    expect(mockDb.setFitnessRouteHeatmapShareToken).not.toHaveBeenCalled()
  })

  it('returns 403 for another actor', async () => {
    mockGetActorFromSession.mockResolvedValue({
      ...seedActor1,
      id: 'https://llun.test/users/other'
    })

    const response = await POST(
      postRequest({ period_type: 'all_time', period_key: 'all' }),
      { params: Promise.resolve({ id: encodedId }) }
    )

    expect(response.status).toBe(403)
  })

  it('returns 401 without a session', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await POST(
      postRequest({ period_type: 'all_time', period_key: 'all' }),
      { params: Promise.resolve({ id: encodedId }) }
    )

    expect(response.status).toBe(401)
  })

  describe('DELETE', () => {
    it('revokes sharing for the owner', async () => {
      mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue(
        completedHeatmap({ shareToken: 'existing-token' })
      )

      const request = new NextRequest(
        `${baseUrl}?period_type=all_time&period_key=all`,
        { method: 'DELETE', headers: { Origin: 'https://test.llun.dev' } }
      )
      const response = await DELETE(request, {
        params: Promise.resolve({ id: encodedId })
      })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ shared: false })
      expect(mockDb.clearFitnessRouteHeatmapShareToken).toHaveBeenCalledWith({
        actorId: ACTOR1_ID,
        id: 'route-heatmap-share'
      })
    })

    it('is a no-op when the heatmap is missing', async () => {
      mockDb.getFitnessRouteHeatmapByKey.mockResolvedValue(null)

      const request = new NextRequest(
        `${baseUrl}?period_type=all_time&period_key=all`,
        { method: 'DELETE', headers: { Origin: 'https://test.llun.dev' } }
      )
      const response = await DELETE(request, {
        params: Promise.resolve({ id: encodedId })
      })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ shared: false })
      expect(mockDb.clearFitnessRouteHeatmapShareToken).not.toHaveBeenCalled()
    })

    it('rejects a cross-site DELETE without same-origin proof', async () => {
      const request = new NextRequest(
        `${baseUrl}?period_type=all_time&period_key=all`,
        { method: 'DELETE' }
      )
      const response = await DELETE(request, {
        params: Promise.resolve({ id: encodedId })
      })

      expect(response.status).toBe(403)
      expect(mockDb.clearFitnessRouteHeatmapShareToken).not.toHaveBeenCalled()
    })
  })

  // PostgreSQL rejects a NUL byte in a bound text parameter (22021), so one
  // reaching the cache-key lookup was a 500 there and a 404 on SQLite.
  describe('an activity_type carrying a NUL byte', () => {
    const ORIGIN = 'https://test.llun.dev'

    const expectBadRequest = async (response: Response) => {
      expect(response.status).toBe(400)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
      await expect(response.json()).resolves.toEqual({ error: 'Bad Request' })
      expect(mockDb.getFitnessRouteHeatmapByKey).not.toHaveBeenCalled()
    }

    it('rejects a POST before the lookup', async () => {
      await expectBadRequest(
        await POST(
          postRequest({
            activity_type: '\u0000',
            period_type: 'all_time',
            period_key: 'all'
          }),
          { params: Promise.resolve({ id: encodedId }) }
        )
      )
      expect(mockDb.setFitnessRouteHeatmapShareToken).not.toHaveBeenCalled()
    })

    it('rejects a DELETE before the lookup', async () => {
      const request = new NextRequest(
        `${baseUrl}?period_type=all_time&period_key=all&activity_type=%00`,
        { method: 'DELETE', headers: { Origin: ORIGIN } }
      )
      await expectBadRequest(
        await DELETE(request, { params: Promise.resolve({ id: encodedId }) })
      )
      expect(mockDb.clearFitnessRouteHeatmapShareToken).not.toHaveBeenCalled()
    })
  })

  describe('period_key validation', () => {
    const invalidPeriodKeys = [
      ['all_time', 'some-junk-key-1'],
      ['all_time', '2026'],
      ['yearly', 'NaN'],
      ['yearly', '2026-04'],
      ['yearly', '1800'],
      ['monthly', '2026'],
      ['monthly', '2026-13'],
      ['monthly', '2026-00'],
      ['monthly', 'x'.repeat(40)]
    ]

    it.each(invalidPeriodKeys)(
      'rejects a POST of %s with period_key %s before the lookup',
      async (type, key) => {
        const response = await POST(
          postRequest({ period_type: type, period_key: key }),
          { params: Promise.resolve({ id: encodedId }) }
        )

        expect(response.status).toBe(400)
        expect(mockDb.getFitnessRouteHeatmapByKey).not.toHaveBeenCalled()
        expect(mockDb.setFitnessRouteHeatmapShareToken).not.toHaveBeenCalled()
      }
    )

    it.each(invalidPeriodKeys)(
      'rejects a DELETE of %s with period_key %s before the lookup',
      async (type, key) => {
        const response = await DELETE(
          new NextRequest(
            `${baseUrl}?period_type=${type}&period_key=${encodeURIComponent(key)}`,
            { method: 'DELETE', headers: { Origin: 'https://test.llun.dev' } }
          ),
          { params: Promise.resolve({ id: encodedId }) }
        )

        expect(response.status).toBe(400)
        expect(mockDb.getFitnessRouteHeatmapByKey).not.toHaveBeenCalled()
        expect(mockDb.clearFitnessRouteHeatmapShareToken).not.toHaveBeenCalled()
      }
    )
  })

  // The same 22021 applies to period_key, which is bound as the cache key.
  describe('a period_key carrying a NUL byte', () => {
    const ORIGIN = 'https://test.llun.dev'

    const expectBadRequest = async (response: Response) => {
      expect(response.status).toBe(400)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
      await expect(response.json()).resolves.toEqual({ error: 'Bad Request' })
      expect(mockDb.getFitnessRouteHeatmapByKey).not.toHaveBeenCalled()
    }

    it('rejects a POST before the lookup', async () => {
      await expectBadRequest(
        await POST(
          postRequest({ period_type: 'all_time', period_key: '\u0000' }),
          { params: Promise.resolve({ id: encodedId }) }
        )
      )
      expect(mockDb.setFitnessRouteHeatmapShareToken).not.toHaveBeenCalled()
    })

    it('rejects a DELETE before the lookup', async () => {
      const request = new NextRequest(
        `${baseUrl}?period_type=all_time&period_key=%00`,
        { method: 'DELETE', headers: { Origin: ORIGIN } }
      )
      await expectBadRequest(
        await DELETE(request, { params: Promise.resolve({ id: encodedId }) })
      )
      expect(mockDb.clearFitnessRouteHeatmapShareToken).not.toHaveBeenCalled()
    })
  })
})
