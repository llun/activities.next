import { logger } from '@/lib/utils/logger'

/**
 * Decode a Google-encoded polyline string into an array of [lat, lng] coordinates.
 * Based on the algorithm: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): [number, number][] {
  const coordinates: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    // Decode latitude
    let shift = 0
    let result = 0
    let byte: number

    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    const dlat = result & 1 ? ~(result >> 1) : result >> 1
    lat += dlat

    // Decode longitude
    shift = 0
    result = 0

    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    const dlng = result & 1 ? ~(result >> 1) : result >> 1
    lng += dlng

    coordinates.push([lat / 1e5, lng / 1e5])
  }

  return coordinates
}

/**
 * Calculate the bounding box of a set of coordinates
 */
function getBoundingBox(coordinates: [number, number][]): {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
} {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity

  for (const [lat, lng] of coordinates) {
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
  }

  return { minLat, maxLat, minLng, maxLng }
}

/**
 * Simplify a polyline by reducing the number of points (Douglas-Peucker algorithm simplified)
 * Used to reduce URL length for static map APIs
 */
function simplifyPolyline(
  coordinates: [number, number][],
  maxPoints: number = 100
): [number, number][] {
  if (coordinates.length <= maxPoints) {
    return coordinates
  }

  // Simple evenly-spaced sampling
  const step = Math.ceil(coordinates.length / maxPoints)
  const simplified: [number, number][] = []

  for (let i = 0; i < coordinates.length; i += step) {
    simplified.push(coordinates[i])
  }

  // Always include the last point
  if (
    simplified[simplified.length - 1] !== coordinates[coordinates.length - 1]
  ) {
    simplified.push(coordinates[coordinates.length - 1])
  }

  return simplified
}

/**
 * Re-encode coordinates to a polyline string
 */
export function encodePolyline(coordinates: [number, number][]): string {
  let encoded = ''
  let prevLat = 0
  let prevLng = 0

  for (const [lat, lng] of coordinates) {
    const latInt = Math.round(lat * 1e5)
    const lngInt = Math.round(lng * 1e5)

    encoded += encodeNumber(latInt - prevLat)
    encoded += encodeNumber(lngInt - prevLng)

    prevLat = latInt
    prevLng = lngInt
  }

  return encoded
}

function encodeNumber(num: number): string {
  let value = num < 0 ? ~(num << 1) : num << 1
  let encoded = ''

  while (value >= 0x20) {
    encoded += String.fromCharCode((0x20 | (value & 0x1f)) + 63)
    value >>= 5
  }

  encoded += String.fromCharCode(value + 63)
  return encoded
}

export interface MapGeneratorOptions {
  width?: number
  height?: number
  pathColor?: string
  pathWeight?: number
  zoom?: number // Manual zoom override, otherwise auto-calculated
}

const DEFAULT_OPTIONS: Required<Omit<MapGeneratorOptions, 'zoom'>> = {
  width: 600,
  height: 400,
  pathColor: 'fc5200', // Strava orange
  pathWeight: 4
}

/**
 * Generate a static map image URL using OpenStreetMap-based Geoapify service
 * This is a free-tier compatible static map API
 */
export function generateStaticMapUrl(
  polyline: string,
  options: MapGeneratorOptions = {}
): string {
  const coordinates = decodePolyline(polyline)

  if (coordinates.length === 0) {
    throw new Error('Polyline contains no coordinates')
  }

  const opts = { ...DEFAULT_OPTIONS, ...options }
  const simplifiedCoords = simplifyPolyline(coordinates, 80)

  // Use Geoapify Static Maps API (free tier: 3000 requests/day)
  // Format: https://maps.geoapify.com/v1/staticmap
  const bbox = getBoundingBox(simplifiedCoords)

  // Build path string for Geoapify
  const pathStr = simplifiedCoords
    .map(([lat, lng]) => `${lng},${lat}`)
    .join(',')

  const url = new URL('https://maps.geoapify.com/v1/staticmap')
  url.searchParams.set('style', 'osm-bright')
  url.searchParams.set('width', opts.width.toString())
  url.searchParams.set('height', opts.height.toString())

  // Set bounding box with padding
  const latPadding = (bbox.maxLat - bbox.minLat) * 0.1
  const lngPadding = (bbox.maxLng - bbox.minLng) * 0.1
  url.searchParams.set(
    'area',
    `rect:${bbox.minLng - lngPadding},${bbox.minLat - latPadding},${bbox.maxLng + lngPadding},${bbox.maxLat + latPadding}`
  )

  // Add path as GeoJSON line
  url.searchParams.set(
    'geometry',
    `polyline:${pathStr};linecolor:%23${opts.pathColor};linewidth:${opts.pathWeight}`
  )

  return url.toString()
}

/**
 * Generate a static map image URL using OpenStreetMap static map web service
 * Fallback option that doesn't require API key
 */
export function generateOSMStaticMapUrl(
  polyline: string,
  options: MapGeneratorOptions = {}
): string {
  const coordinates = decodePolyline(polyline)

  if (coordinates.length === 0) {
    throw new Error('Polyline contains no coordinates')
  }

  const opts = { ...DEFAULT_OPTIONS, ...options }
  const simplifiedCoords = simplifyPolyline(coordinates, 50)
  const bbox = getBoundingBox(simplifiedCoords)

  // Calculate center
  const centerLat = (bbox.minLat + bbox.maxLat) / 2
  const centerLng = (bbox.minLng + bbox.maxLng) / 2

  // Calculate zoom level based on bounding box
  const latDiff = bbox.maxLat - bbox.minLat
  const lngDiff = bbox.maxLng - bbox.minLng
  const maxDiff = Math.max(latDiff, lngDiff)

  let zoom = 14
  if (maxDiff > 0.5) zoom = 10
  else if (maxDiff > 0.2) zoom = 11
  else if (maxDiff > 0.1) zoom = 12
  else if (maxDiff > 0.05) zoom = 13

  if (options.zoom) zoom = options.zoom

  // Use staticmap.net (no API key required)
  const pathCoords = simplifiedCoords
    .map(([lat, lng]) => `${lat},${lng}`)
    .join('|')

  const url = new URL('https://staticmap.net/api/v1/staticmap')
  url.searchParams.set('center', `${centerLat},${centerLng}`)
  url.searchParams.set('zoom', zoom.toString())
  url.searchParams.set('size', `${opts.width}x${opts.height}`)
  url.searchParams.set(
    'path',
    `color:0x${opts.pathColor}|weight:${opts.pathWeight}|${pathCoords}`
  )

  return url.toString()
}

/**
 * Fetch a static map image as a buffer
 */
export async function generateMapImage(
  polyline: string,
  options: MapGeneratorOptions = {}
): Promise<Buffer | null> {
  try {
    // Use staticmap.net as it does not require an API key.
    const url = generateOSMStaticMapUrl(polyline, options)

    logger.info({
      message: 'Fetching static map image',
      url: url.substring(0, 200) + '...' // Truncate for logging
    })

    const response = await fetch(url)

    if (!response.ok) {
      logger.error({
        message: 'Failed to fetch static map image',
        status: response.status
      })
      return null
    }

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch (error) {
    logger.error({
      message: 'Error generating map image',
      error
    })
    return null
  }
}

/**
 * Get the content type for a map image
 */
export function getMapImageContentType(): string {
  return 'image/png'
}
