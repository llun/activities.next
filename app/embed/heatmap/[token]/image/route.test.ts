import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'

import { GET } from './route'

const mockGetFitnessRouteHeatmapByShareToken = vi.fn()
let mockDatabase: Pick<Database, 'getFitnessRouteHeatmapByShareToken'> | null =
  {
    getFitnessRouteHeatmapByShareToken: mockGetFitnessRouteHeatmapByShareToken
  }
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const mockGetConfig = vi.fn()
vi.mock('@/lib/config', () => ({
  getConfig: () => mockGetConfig()
}))

const sharedHeatmap = {
  id: 'heatmap-1',
  actorId: 'https://example.test/actors/alice',
  periodType: 'all_time' as const,
  periodKey: 'all',
  region: '',
  bounds: { minLat: 52, maxLat: 53, minLng: 4, maxLng: 5 },
  segments: [
    {
      // A privacy-hidden segment: the embed must still render it (uniformly).
      isHiddenByPrivacy: true,
      points: [
        { lat: 52.1, lng: 4.2 },
        { lat: 52.2, lng: 4.3 }
      ]
    }
  ],
  status: 'completed' as const,
  activityCount: 1,
  pointCount: 2,
  totalCount: 2,
  cursorOffset: 0,
  isPartial: false,
  shareToken: 'token-1',
  createdAt: 1,
  updatedAt: 2
}

const imageRequest = (token = 'token-1') =>
  new NextRequest(`http://llun.test/embed/heatmap/${token}/image`)

describe('/embed/heatmap/[token]/image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase = {
      getFitnessRouteHeatmapByShareToken: mockGetFitnessRouteHeatmapByShareToken
    }
    mockGetFitnessRouteHeatmapByShareToken.mockResolvedValue(sharedHeatmap)
    mockGetConfig.mockReturnValue({ fitnessStorage: { mapboxAccessToken: '' } })
  })

  it('returns 404 for an unknown share token', async () => {
    mockGetFitnessRouteHeatmapByShareToken.mockResolvedValue(null)

    const response = await GET(imageRequest('missing'), {
      params: Promise.resolve({ token: 'missing' })
    })

    expect(response.status).toBe(404)
  })

  it('returns 404 for a shared heatmap that is not completed', async () => {
    mockGetFitnessRouteHeatmapByShareToken.mockResolvedValue({
      ...sharedHeatmap,
      status: 'generating'
    })

    const response = await GET(imageRequest(), {
      params: Promise.resolve({ token: 'token-1' })
    })

    expect(response.status).toBe(404)
  })

  it('pins the response content-type to an image even if upstream lies', async () => {
    mockGetConfig.mockReturnValue({
      fitnessStorage: { mapboxAccessToken: 'pk.test-token' }
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: { 'content-type': 'text/html' }
      })
    )

    try {
      const response = await GET(imageRequest(), {
        params: Promise.resolve({ token: 'token-1' })
      })

      expect(response.headers.get('Content-Type')).toBe('image/png')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('renders an SVG fallback when no Mapbox token is configured', async () => {
    const response = await GET(imageRequest(), {
      params: Promise.resolve({ token: 'token-1' })
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('image/svg+xml')
    const body = await response.text()
    // The privacy-hidden segment is still drawn (no hole), uniformly coloured.
    expect(body).toContain('<polyline')
    expect(body).toContain('stroke="#ef4444"')
  })

  it('proxies the Mapbox static image when a token is configured', async () => {
    mockGetConfig.mockReturnValue({
      fitnessStorage: { mapboxAccessToken: 'pk.test-token' }
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/png' }
      })
    )

    try {
      const response = await GET(imageRequest(), {
        params: Promise.resolve({ token: 'token-1' })
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('image/png')
      const requestedUrl = fetchSpy.mock.calls[0]?.[0] as string
      expect(requestedUrl).toContain(
        'https://api.mapbox.com/styles/v1/mapbox/light-v11/static/'
      )
      expect(requestedUrl).toContain('access_token=pk.test-token')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('uses the default dimensions when w/h are omitted', async () => {
    mockGetConfig.mockReturnValue({
      fitnessStorage: { mapboxAccessToken: 'pk.test-token' }
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: { 'content-type': 'image/png' }
      })
    )

    try {
      const response = await GET(imageRequest(), {
        params: Promise.resolve({ token: 'token-1' })
      })

      expect(response.status).toBe(200)
      // Number(null) === 0 must NOT collapse the default to MIN_DIMENSION.
      const requestedUrl = fetchSpy.mock.calls[0]?.[0] as string
      expect(requestedUrl).toContain('/600x400@2x')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('snaps w/h to coarse buckets to limit the cache surface', async () => {
    mockGetConfig.mockReturnValue({
      fitnessStorage: { mapboxAccessToken: 'pk.test-token' }
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: { 'content-type': 'image/png' }
      })
    )

    try {
      const response = await GET(
        new NextRequest(
          'http://llun.test/embed/heatmap/token-1/image?w=637&h=413'
        ),
        { params: Promise.resolve({ token: 'token-1' }) }
      )

      expect(response.status).toBe(200)
      // 637 → 600, 413 → 400 (snapped to the nearest 100).
      const requestedUrl = fetchSpy.mock.calls[0]?.[0] as string
      expect(requestedUrl).toContain('/600x400@2x')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('falls back to SVG when the Mapbox fetch fails', async () => {
    mockGetConfig.mockReturnValue({
      fitnessStorage: { mapboxAccessToken: 'pk.test-token' }
    })
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network down'))

    try {
      const response = await GET(imageRequest(), {
        params: Promise.resolve({ token: 'token-1' })
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('image/svg+xml')
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
