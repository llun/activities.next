import { NextRequest } from 'next/server'
import crypto from 'node:crypto'

import { Database } from '@/lib/database/types'
import { encodeTile } from '@/lib/services/fitness-files/heatmapTiles/tileCodec'
import { simplifySegmentsToBudget } from '@/lib/services/fitness-files/simplifyRoute'

import { GET } from './route'

// Wraps the real implementations so every other test keeps real behaviour, while
// letting the many-segment case assert that no Douglas-Peucker work is done at
// all. That CPU bail is the point of MAX_SNAPSHOT_OVERLAYS on this anonymous,
// CORS-enabled route: without it the assertion below still passes (the ladder
// also returns null), so a plain "serves SVG" assertion cannot fail.
vi.mock('@/lib/services/fitness-files/simplifyRoute', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/services/fitness-files/simplifyRoute')
  >('@/lib/services/fitness-files/simplifyRoute')
  return {
    MAX_BUDGET_PASSES: actual.MAX_BUDGET_PASSES,
    totalPointCount: vi.fn(actual.totalPointCount),
    everySegmentAtMinimum: vi.fn(actual.everySegmentAtMinimum),
    simplifyPoints: vi.fn(actual.simplifyPoints),
    simplifySegments: vi.fn(actual.simplifySegments),
    simplifySegmentsToBudget: vi.fn(actual.simplifySegmentsToBudget)
  }
})

const mockGetFitnessRouteHeatmapByShareToken = vi.fn()
const mockGetFitnessRouteHeatmapPyramid = vi.fn()
const mockGetFitnessRouteHeatmapTilesInRange = vi.fn()
let mockDatabase: Pick<
  Database,
  | 'getFitnessRouteHeatmapByShareToken'
  | 'getFitnessRouteHeatmapPyramid'
  | 'getFitnessRouteHeatmapTilesInRange'
> | null = {
  getFitnessRouteHeatmapByShareToken: mockGetFitnessRouteHeatmapByShareToken,
  getFitnessRouteHeatmapPyramid: mockGetFitnessRouteHeatmapPyramid,
  getFitnessRouteHeatmapTilesInRange: mockGetFitnessRouteHeatmapTilesInRange
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
      getFitnessRouteHeatmapByShareToken:
        mockGetFitnessRouteHeatmapByShareToken,
      getFitnessRouteHeatmapPyramid: mockGetFitnessRouteHeatmapPyramid,
      getFitnessRouteHeatmapTilesInRange: mockGetFitnessRouteHeatmapTilesInRange
    }
    mockGetFitnessRouteHeatmapByShareToken.mockResolvedValue(sharedHeatmap)
    // No pyramid by default: every existing case is about the blob path.
    mockGetFitnessRouteHeatmapPyramid.mockResolvedValue(null)
    mockGetFitnessRouteHeatmapTilesInRange.mockResolvedValue([])
    mockGetMapProviderConfig.mockReturnValue({ type: 'osm' })
  })

  describe('pyramid-backed images', () => {
    const pyramid = {
      id: 'pyramid-1',
      actorId: sharedHeatmap.actorId,
      status: 'completed' as const,
      version: 3,
      claimSeq: 1,
      totalCount: 1,
      scannedCount: 1,
      activityCount: 1,
      tileCount: 1,
      pointCount: 4,
      createdAt: 1,
      updatedAt: 2
    }

    const tileRow = (z: number, x: number, y: number, segments: string) => ({
      actorId: sharedHeatmap.actorId,
      tileKey: `${z}:${x}:${y}`,
      z,
      x,
      y,
      version: 3,
      segments,
      pointCount: 2,
      createdAt: 1,
      updatedAt: 2
    })

    it('draws from tiles, shading each run by its visit count', async () => {
      // The blob was simplified once to a single global budget, so a city
      // thumbnail drawn from it shows the same coarse lines a whole-world view
      // would. Tiles are simplified per rung.
      mockGetFitnessRouteHeatmapPyramid.mockResolvedValue(pyramid)
      mockGetFitnessRouteHeatmapTilesInRange.mockImplementation(
        async ({ z, minX, minY }) => [
          tileRow(
            z,
            minX,
            minY,
            encodeTile([{ count: 6, points: [0, 0, 128, 128] }])
          )
        ]
      )

      const response = await GET(imageRequest(), {
        params: Promise.resolve({ token: 'token-1' })
      })
      const svg = await response.text()

      expect(response.status).toBe(200)
      expect(mockGetFitnessRouteHeatmapTilesInRange).toHaveBeenCalled()
      // Shaded, not the flat opacity the untiled path uses.
      expect(svg).not.toContain('stroke-opacity="0.85"')
      expect(svg).toContain('<polyline')
    })

    it('keeps the stored blob when the actor has no completed build', async () => {
      mockGetFitnessRouteHeatmapPyramid.mockResolvedValue(null)

      const response = await GET(imageRequest(), {
        params: Promise.resolve({ token: 'token-1' })
      })
      const svg = await response.text()

      expect(response.status).toBe(200)
      expect(svg).toContain('stroke-opacity="0.85"')
    })

    it('keeps the stored blob when the pyramid read fails', async () => {
      // An image the owner already had beats no image at all.
      mockGetFitnessRouteHeatmapPyramid.mockRejectedValue(
        new Error('pyramid table unavailable')
      )

      const response = await GET(imageRequest(), {
        params: Promise.resolve({ token: 'token-1' })
      })

      expect(response.status).toBe(200)
      expect(await response.text()).toContain('stroke-opacity="0.85"')
    })

    it('keeps the stored blob when the pyramid holds nothing for this view', async () => {
      mockGetFitnessRouteHeatmapPyramid.mockResolvedValue(pyramid)
      mockGetFitnessRouteHeatmapTilesInRange.mockResolvedValue([])

      const response = await GET(imageRequest(), {
        params: Promise.resolve({ token: 'token-1' })
      })

      expect(await response.text()).toContain('stroke-opacity="0.85"')
    })
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

  it.each([
    {
      description: 'a rectangle rounding had collapsed',
      region: 'rect:52.00,5.00,52.00,5.00'
    },
    { description: 'an unparseable token', region: 'rect:not-a-number,5,4,6' }
  ])(
    'returns 404 for a share whose region is $description',
    async ({ region }) => {
      // The stored geometry for such a row was built with NO clipping — the job
      // reads the same unresolvable region as world scope — so what this image
      // would render is the actor's whole history under a rectangle's label.
      // There is nothing left to clip; refusing is the only remedy short of
      // regenerating the row.
      mockGetFitnessRouteHeatmapByShareToken.mockResolvedValue({
        ...sharedHeatmap,
        region
      })

      const response = await GET(imageRequest(), {
        params: Promise.resolve({ token: 'token-1' })
      })

      expect(response.status).toBe(404)
    }
  )

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
    vi.mocked(simplifySegmentsToBudget).mockClear()

    try {
      const response = await GET(imageRequest(), {
        params: Promise.resolve({ token: 'token-1' })
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('image/svg+xml')
      expect(fetchSpy).not.toHaveBeenCalled()
      // The real assertion: an infeasible heatmap must be rejected BEFORE any
      // route simplification runs. Serving SVG alone proves nothing here — the
      // ladder would also end up returning null, just after burning the CPU.
      expect(vi.mocked(simplifySegmentsToBudget)).not.toHaveBeenCalled()
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
