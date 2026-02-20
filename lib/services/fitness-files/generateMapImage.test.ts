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
})
