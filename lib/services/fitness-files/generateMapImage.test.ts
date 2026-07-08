import crypto from 'node:crypto'
import sharp from 'sharp'

import { getMapProviderConfig } from '@/lib/config/mapProvider'

import { generateMapImage } from './generateMapImage'

vi.mock('@/lib/config/mapProvider', () => ({
  getMapProviderConfig: vi.fn(),
  getPublicMapProvider: vi.fn()
}))

const mockGetMapProviderConfig = getMapProviderConfig as jest.MockedFunction<
  typeof getMapProviderConfig
>

const applePrivateKey = crypto
  .generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString()

const appleProvider = {
  type: 'apple' as const,
  teamId: 'TEAM123',
  keyId: 'KEY456',
  privateKey: applePrivateKey
}

const coordinates = [
  { lat: 37.78, lng: -122.42 },
  { lat: 37.79, lng: -122.41 }
]

const pngTile = async () =>
  sharp({
    create: { width: 256, height: 256, channels: 4, background: '#94a3b8' }
  })
    .png()
    .toBuffer()

// Match on the parsed hostname rather than a substring of the whole URL: an
// `includes('mapbox.com')` style check also matches `evil.com/?x=mapbox.com`,
// so it both misroutes the fetch mock and trips CodeQL's
// js/incomplete-url-substring-sanitization rule.
const hostnameOf = (url: unknown) => new URL(String(url)).hostname

describe('generateMapImage', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('returns null for empty coordinates', async () => {
    mockGetMapProviderConfig.mockReturnValue({ type: 'osm' })

    const result = await generateMapImage({ coordinates: [] })

    expect(result).toBeNull()
  })

  it('uses the Apple Maps snapshot when the Apple provider is selected', async () => {
    const snapshotBuffer = Buffer.from('apple-snapshot-binary')
    mockGetMapProviderConfig.mockReturnValue(appleProvider)

    global.fetch = vi.fn().mockResolvedValue(
      new Response(snapshotBuffer, {
        status: 200,
        headers: { 'Content-Type': 'image/png' }
      })
    ) as unknown as typeof fetch

    const result = await generateMapImage({ coordinates })

    expect(result).toEqual(snapshotBuffer)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const requestedUrl = String((global.fetch as jest.Mock).mock.calls[0][0])
    expect(requestedUrl).toContain('snapshot.apple-mapkit.com')
    expect(requestedUrl).toContain('&signature=')
    // Apple clamps each dimension to 640; the 800x600 default is not requested.
    expect(requestedUrl).toContain('size=640x480')
  })

  it('falls back to OSM tiles when the Apple Maps snapshot fails', async () => {
    mockGetMapProviderConfig.mockReturnValue(appleProvider)

    const tileBuffer = await pngTile()
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (hostnameOf(url) === 'snapshot.apple-mapkit.com') {
        return new Response('too long', { status: 413 })
      }
      return new Response(Buffer.from(tileBuffer), {
        status: 200,
        headers: { 'Content-Type': 'image/png' }
      })
    }) as unknown as typeof fetch

    const result = await generateMapImage({ coordinates })

    expect(result?.length).toBeGreaterThan(0)
    const requestedUrls = (global.fetch as jest.Mock).mock.calls.map((call) =>
      String(call[0])
    )
    expect(requestedUrls[0]).toContain('snapshot.apple-mapkit.com')
    expect(requestedUrls.length).toBeGreaterThan(1)
  })

  it('uses Mapbox static API when the Mapbox provider is selected', async () => {
    const mapboxBuffer = Buffer.from('mapbox-image-binary')

    mockGetMapProviderConfig.mockReturnValue({
      type: 'mapbox',
      accessToken: 'test-mapbox-token'
    })

    global.fetch = vi.fn().mockResolvedValue(
      new Response(mapboxBuffer, {
        status: 200,
        headers: { 'Content-Type': 'image/png' }
      })
    ) as unknown as typeof fetch

    const result = await generateMapImage({ coordinates })

    expect(result).toEqual(mapboxBuffer)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('mapbox.com')
  })

  it('falls back to OSM tiles when the Mapbox request fails', async () => {
    mockGetMapProviderConfig.mockReturnValue({
      type: 'mapbox',
      accessToken: 'test-mapbox-token'
    })

    const tileBuffer = await pngTile()
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (hostnameOf(url) === 'api.mapbox.com') {
        return new Response('nope', { status: 401 })
      }
      return new Response(Buffer.from(tileBuffer), {
        status: 200,
        headers: { 'Content-Type': 'image/png' }
      })
    }) as unknown as typeof fetch

    const result = await generateMapImage({ coordinates })

    expect(result?.length).toBeGreaterThan(0)
  })

  it('renders OSM map tiles for the keyless OpenStreetMap provider', async () => {
    mockGetMapProviderConfig.mockReturnValue({ type: 'osm' })

    const tileBuffer = await pngTile()
    global.fetch = vi.fn().mockImplementation(async () => {
      return new Response(Buffer.from(tileBuffer), {
        status: 200,
        headers: { 'Content-Type': 'image/png' }
      })
    }) as unknown as typeof fetch

    const result = await generateMapImage({ coordinates })

    expect(result).toBeDefined()
    expect(result?.length).toBeGreaterThan(0)
    expect(global.fetch).toHaveBeenCalled()
    const requestedUrls = (global.fetch as jest.Mock).mock.calls.map((call) =>
      String(call[0])
    )
    expect(
      requestedUrls.every((url) => hostnameOf(url) !== 'api.mapbox.com')
    ).toBe(true)
  })

  it('caps mapbox route geometry point count for heavily segmented routes', async () => {
    const mapboxBuffer = Buffer.from('mapbox-image-binary')

    mockGetMapProviderConfig.mockReturnValue({
      type: 'mapbox',
      accessToken: 'test-mapbox-token'
    })

    global.fetch = vi.fn().mockResolvedValue(
      new Response(mapboxBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'image/png'
        }
      })
    ) as unknown as typeof fetch

    const routeSegments = Array.from({ length: 700 }, (_, index) => {
      const lat = 52.1 + index * 0.0002
      const lng = 5.1 + index * 0.0002

      return [
        { lat, lng },
        { lat: lat + 0.00008, lng: lng + 0.00008 }
      ]
    })

    await generateMapImage({
      coordinates: routeSegments.flat(),
      routeSegments
    })

    const requestUrl = String((global.fetch as jest.Mock).mock.calls[0][0])
    const geoJsonStart = requestUrl.indexOf('geojson(')
    const geoJsonEnd = requestUrl.indexOf(')/auto/')
    const encodedGeoJson = requestUrl.slice(geoJsonStart + 8, geoJsonEnd)
    const parsedGeoJson = JSON.parse(decodeURIComponent(encodedGeoJson)) as {
      geometry:
        | {
            type: 'LineString'
            coordinates: number[][]
          }
        | {
            type: 'MultiLineString'
            coordinates: number[][][]
          }
    }

    const totalPoints =
      parsedGeoJson.geometry.type === 'LineString'
        ? parsedGeoJson.geometry.coordinates.length
        : parsedGeoJson.geometry.coordinates.reduce((sum, segment) => {
            return sum + segment.length
          }, 0)

    expect(totalPoints).toBeLessThanOrEqual(250)
    if (parsedGeoJson.geometry.type === 'MultiLineString') {
      expect(
        parsedGeoJson.geometry.coordinates.every((segment) => {
          return segment.length >= 2
        })
      ).toBe(true)
    }
  })
})
