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
    const json = await response.json()
    expect(typeof json.shareToken).toBe('string')
    expect(json.shareToken.length).toBeGreaterThan(0)
    expect(mockDb.setFitnessRouteHeatmapShareToken).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      id: 'route-heatmap-share',
      shareToken: json.shareToken
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
})
