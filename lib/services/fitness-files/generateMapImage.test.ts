import sharp from 'sharp'

import { getConfig } from '@/lib/config'

import { generateMapImage } from './generateMapImage'

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn()
}))

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>

describe('generateMapImage', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.clearAllMocks()
  })

  it('returns null for empty coordinates', async () => {
    mockGetConfig.mockReturnValue({} as ReturnType<typeof getConfig>)

    const result = await generateMapImage({ coordinates: [] })

    expect(result).toBeNull()
  })

  it('uses Mapbox static API when access token is configured', async () => {
    const mapboxBuffer = Buffer.from('mapbox-image-binary')

    mockGetConfig.mockReturnValue({
      fitnessStorage: {
        mapboxAccessToken: 'test-mapbox-token'
      }
    } as ReturnType<typeof getConfig>)

    global.fetch = jest.fn().mockResolvedValue(
      new Response(mapboxBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'image/png'
        }
      })
    ) as unknown as typeof fetch

    const result = await generateMapImage({
      coordinates: [
        { lat: 37.78, lng: -122.42 },
        { lat: 37.79, lng: -122.41 }
      ]
    })

    expect(result).toEqual(mapboxBuffer)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('mapbox.com')
  })

  it('renders OSM map tiles when Mapbox token is not set', async () => {
    mockGetConfig.mockReturnValue({
      fitnessStorage: {
        mapboxAccessToken: undefined
      }
    } as ReturnType<typeof getConfig>)

    const tileBuffer = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 4,
        background: '#94a3b8'
      }
    })
      .png()
      .toBuffer()

    global.fetch = jest.fn().mockImplementation(async () => {
      return new Response(Buffer.from(tileBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'image/png'
        }
      })
    }) as unknown as typeof fetch

    const result = await generateMapImage({
      coordinates: [
        { lat: 37.78, lng: -122.42 },
        { lat: 37.79, lng: -122.41 }
      ]
    })

    expect(result).toBeDefined()
    expect(result?.length).toBeGreaterThan(0)
    expect(global.fetch).toHaveBeenCalled()
  })

  it('caps mapbox route geometry point count for heavily segmented routes', async () => {
    const mapboxBuffer = Buffer.from('mapbox-image-binary')

    mockGetConfig.mockReturnValue({
      fitnessStorage: {
        mapboxAccessToken: 'test-mapbox-token'
      }
    } as ReturnType<typeof getConfig>)

    global.fetch = jest.fn().mockResolvedValue(
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

    expect(totalPoints).toBeLessThanOrEqual(500)
    if (parsedGeoJson.geometry.type === 'MultiLineString') {
      expect(
        parsedGeoJson.geometry.coordinates.every((segment) => {
          return segment.length >= 2
        })
      ).toBe(true)
    }
  })
})
