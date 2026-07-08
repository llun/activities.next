import { NextRequest } from 'next/server'
import crypto from 'node:crypto'

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

const mockGetMapProviderConfig = vi.fn()
vi.mock('@/lib/config/mapProvider', () => ({
  getMapProviderConfig: () => mockGetMapProviderConfig(),
  getPublicMapProvider: vi.fn()
}))

const appleProvider = {
  type: 'apple' as const,
  teamId: 'TEAM123',
  keyId: 'KEY456',
  privateKey: crypto
    .generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()
}

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
    mockGetMapProviderConfig.mockReturnValue({ type: 'osm' })
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
    mockGetMapProviderConfig.mockReturnValue({
      type: 'mapbox',
      accessToken: 'pk.test-token'
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

  it('renders an SVG fallback for the keyless OpenStreetMap provider', async () => {
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

  it('proxies the signed Apple Maps snapshot for the Apple provider', async () => {
    mockGetMapProviderConfig.mockReturnValue(appleProvider)
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
        'https://snapshot.apple-mapkit.com/api/v1/snapshot?'
      )
      // The default 600x400 embed size already fits Apple's 50..640 range.
      expect(requestedUrl).toContain('size=600x400')
      expect(requestedUrl).toContain('scale=2')
      expect(requestedUrl).toContain('&signature=')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('scales oversized embed dimensions into the Apple snapshot range', async () => {
    mockGetMapProviderConfig.mockReturnValue(appleProvider)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: { 'content-type': 'image/png' }
      })
    )

    try {
      await GET(
        new NextRequest(
          'http://llun.test/embed/heatmap/token-1/image?w=1200&h=1000'
        ),
        { params: Promise.resolve({ token: 'token-1' }) }
      )

      const requestedUrl = fetchSpy.mock.calls[0]?.[0] as string
      // 1200x1000 scaled by 640/1200, not clamped per-axis to 640x640.
      expect(requestedUrl).toContain('size=640x533')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('preserves the requested aspect ratio for a wide Apple snapshot', async () => {
    mockGetMapProviderConfig.mockReturnValue(appleProvider)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: { 'content-type': 'image/png' }
      })
    )

    try {
      await GET(
        new NextRequest(
          'http://llun.test/embed/heatmap/token-1/image?w=1200&h=400'
        ),
        { params: Promise.resolve({ token: 'token-1' }) }
      )

      const requestedUrl = fetchSpy.mock.calls[0]?.[0] as string
      // A 3:1 banner stays 3:1 (640x213), instead of being squashed to 640x400.
      expect(requestedUrl).toContain('size=640x213')
      expect(requestedUrl).not.toContain('size=640x400')
      // The lost logical size is recovered with a 2x pixel density.
      expect(requestedUrl).toContain('scale=2')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('renders the SVG heatmap for an Apple provider with too many segments', async () => {
    // Every segment costs one polyline overlay, so a many-activity heatmap can
    // never fit Apple's snapshot URL budget — no snapshot fetch should happen.
    mockGetMapProviderConfig.mockReturnValue(appleProvider)
    mockGetFitnessRouteHeatmapByShareToken.mockResolvedValue({
      ...sharedHeatmap,
      segments: Array.from({ length: 50 }, (_, index) => ({
        isHiddenByPrivacy: false,
        points: [
          { lat: 52.1 + index * 0.01, lng: 4.2 + index * 0.01 },
          { lat: 52.2 + index * 0.01, lng: 4.3 + index * 0.01 }
        ]
      }))
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    try {
      const response = await GET(imageRequest(), {
        params: Promise.resolve({ token: 'token-1' })
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('image/svg+xml')
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('falls back to SVG when the Apple Maps snapshot fails', async () => {
    mockGetMapProviderConfig.mockReturnValue(appleProvider)
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network down'))

    try {
      const response = await GET(imageRequest(), {
        params: Promise.resolve({ token: 'token-1' })
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('image/svg+xml')
      expect(fetchSpy).toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('proxies the Mapbox static image for a secret sk. token', async () => {
    // The static URL is fetched server-side, so a secret token never reaches the
    // browser — an sk.-only deployment still gets a real Mapbox embed image.
    mockGetMapProviderConfig.mockReturnValue({
      type: 'mapbox',
      accessToken: 'sk.secret-token'
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
      expect(response.headers.get('Content-Type')).toBe('image/png')
      const requestedUrl = fetchSpy.mock.calls[0]?.[0] as string
      expect(requestedUrl).toContain('access_token=sk.secret-token')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('proxies the Mapbox static image when a token is configured', async () => {
    mockGetMapProviderConfig.mockReturnValue({
      type: 'mapbox',
      accessToken: 'pk.test-token'
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
    mockGetMapProviderConfig.mockReturnValue({
      type: 'mapbox',
      accessToken: 'pk.test-token'
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
    mockGetMapProviderConfig.mockReturnValue({
      type: 'mapbox',
      accessToken: 'pk.test-token'
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
    mockGetMapProviderConfig.mockReturnValue({
      type: 'mapbox',
      accessToken: 'pk.test-token'
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
