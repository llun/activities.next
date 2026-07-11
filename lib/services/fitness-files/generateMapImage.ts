import sharp from 'sharp'

import { getMapProviderConfig } from '@/lib/config/mapProvider'
import { fetchAppleSnapshot } from '@/lib/services/fitness-files/appleMapsSnapshot'
import { downsamplePrivacySegments } from '@/lib/services/fitness-files/privacy'
import type { PrivacySegment } from '@/lib/services/fitness-files/privacy'
import { logger } from '@/lib/utils/logger'

import type { FitnessCoordinate } from './mapUtils'
import {
  TILE_SIZE,
  calculateBounds,
  fetchOsmTile,
  getZoomLevel,
  project
} from './mapUtils'

export interface GenerateMapImageParams {
  coordinates: FitnessCoordinate[]
  routeSegments?: FitnessCoordinate[][]
  width?: number
  height?: number
}

const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 600
// Apple Web Snapshots clamp each dimension to 640, so ask for the largest
// allowed 4:3 frame at retina scale instead of the default 800x600.
const APPLE_SNAPSHOT_WIDTH = 640
const APPLE_SNAPSHOT_HEIGHT = 480
const APPLE_SNAPSHOT_SCALE = 2

const flattenRouteSegments = (routeSegments: FitnessCoordinate[][]) => {
  return routeSegments.flat()
}

const normalizeRouteSegments = ({
  coordinates,
  routeSegments
}: {
  coordinates: FitnessCoordinate[]
  routeSegments?: FitnessCoordinate[][]
}): FitnessCoordinate[][] => {
  if (Array.isArray(routeSegments)) {
    const validSegments = routeSegments.filter((segment) => segment.length >= 2)
    if (validSegments.length > 0) {
      return validSegments
    }
  }

  if (coordinates.length >= 2) {
    return [coordinates]
  }

  return []
}

const downsampleRouteSegments = (
  routeSegments: FitnessCoordinate[][],
  maxPoints = 250
): FitnessCoordinate[][] => {
  const privacySegments: Array<
    PrivacySegment<FitnessCoordinate & { isHiddenByPrivacy: boolean }>
  > = routeSegments.map((segment) => ({
    isHiddenByPrivacy: false,
    points: segment.map((coordinate) => ({
      ...coordinate,
      isHiddenByPrivacy: false
    }))
  }))

  return downsamplePrivacySegments(privacySegments, maxPoints, {
    minimumPointsPerSegment: 2
  })
    .map((segment) =>
      segment.points.map((coordinate) => ({
        lat: coordinate.lat,
        lng: coordinate.lng
      }))
    )
    .filter((segment) => segment.length >= 2)
}

const buildMapboxUrl = ({
  routeSegments,
  width,
  height,
  accessToken
}: {
  routeSegments: FitnessCoordinate[][]
  width: number
  height: number
  accessToken: string
}) => {
  const sampledSegments = downsampleRouteSegments(routeSegments)
  if (sampledSegments.length === 0) {
    throw new Error('No route segments remain after downsampling')
  }

  const geometry =
    sampledSegments.length > 1
      ? {
          type: 'MultiLineString',
          coordinates: sampledSegments.map((segment) =>
            segment.map((coordinate) => [coordinate.lng, coordinate.lat])
          )
        }
      : {
          type: 'LineString',
          coordinates: sampledSegments[0].map((coordinate) => [
            coordinate.lng,
            coordinate.lat
          ])
        }

  const geoJson = {
    type: 'Feature',
    properties: {
      stroke: '#ff3b30',
      'stroke-width': 4,
      'stroke-opacity': 0.9
    },
    geometry
  }

  const encodedGeoJson = encodeURIComponent(JSON.stringify(geoJson))

  return (
    `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/` +
    `geojson(${encodedGeoJson})/auto/${width}x${height}` +
    `?padding=48&access_token=${encodeURIComponent(accessToken)}`
  )
}

const renderOsmMap = async ({
  routeSegments,
  width,
  height
}: {
  routeSegments: FitnessCoordinate[][]
  width: number
  height: number
}): Promise<Buffer> => {
  // A long activity (a multi-hour ride can carry >100k GPS points) would
  // otherwise be projected at full resolution, which overflows two ways: the
  // Math.min(...)/Math.max(...) spreads below throw a RangeError past ~130k
  // elements, and the per-point SVG polyline handed to sharp/libvips grows large
  // enough to abort the native process (SIGABRT). An 800x600 map only needs a
  // few hundred points, so downsample the geometry first — exactly what the
  // Mapbox path already does — before projecting anything. The metric series
  // (distance/duration/elevation/HR/power) are derived elsewhere from the
  // full-resolution trackpoints and are unaffected by this render-only cap.
  const sampledSegments = downsampleRouteSegments(routeSegments)
  if (sampledSegments.length === 0) {
    throw new Error('No route segments remain after downsampling')
  }
  const sampledCoordinates = sampledSegments.flat()

  const padding = 56
  const zoom = getZoomLevel({
    coordinates: sampledCoordinates,
    width,
    height,
    padding
  })

  // Single-pass min/max over the projected points (mirrors the reduce loop in
  // calculateCoordinateBounds) — never spread the array into Math.min/Math.max.
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const coordinate of sampledCoordinates) {
    const point = project(coordinate, zoom)
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.y < minY) minY = point.y
    if (point.y > maxY) maxY = point.y
  }

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const topLeftX = centerX - width / 2
  const topLeftY = centerY - height / 2

  const startTileX = Math.floor(topLeftX / TILE_SIZE)
  const endTileX = Math.floor((topLeftX + width) / TILE_SIZE)
  const startTileY = Math.floor(topLeftY / TILE_SIZE)
  const endTileY = Math.floor((topLeftY + height) / TILE_SIZE)

  const tileBuffers = await Promise.all(
    Array.from(
      { length: endTileY - startTileY + 1 },
      (_, yOffset) => startTileY + yOffset
    ).flatMap((tileY) =>
      Array.from(
        { length: endTileX - startTileX + 1 },
        (_, xOffset) => startTileX + xOffset
      ).map(async (tileX) => {
        const tile = await fetchOsmTile(zoom, tileX, tileY)
        return {
          input: tile,
          left: Math.round(tileX * TILE_SIZE - topLeftX),
          top: Math.round(tileY * TILE_SIZE - topLeftY)
        }
      })
    )
  )

  const projectedSegments = sampledSegments.map((segment) =>
    segment.map((coordinate) => {
      const point = project(coordinate, zoom)
      return {
        x: point.x - topLeftX,
        y: point.y - topLeftY
      }
    })
  )

  const polylines = projectedSegments
    .map((segment) => {
      const points = segment
        .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
        .join(' ')
      return `<polyline points="${points}" fill="none" stroke="#ff3b30" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
    })
    .join('')

  const start = projectedSegments[0][0]
  const end =
    projectedSegments[projectedSegments.length - 1][
      projectedSegments[projectedSegments.length - 1].length - 1
    ]

  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">` +
      polylines +
      `<circle cx="${start.x.toFixed(2)}" cy="${start.y.toFixed(2)}" r="5" fill="#16a34a" stroke="#ffffff" stroke-width="2"/>` +
      `<circle cx="${end.x.toFixed(2)}" cy="${end.y.toFixed(2)}" r="5" fill="#dc2626" stroke="#ffffff" stroke-width="2"/>` +
      `</svg>`
  )

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#f8fafc'
    }
  })
    .composite([...tileBuffers, { input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer()
}

export const generateMapImage = async ({
  coordinates,
  routeSegments,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT
}: GenerateMapImageParams): Promise<Buffer | null> => {
  const normalizedRouteSegments = normalizeRouteSegments({
    coordinates,
    routeSegments
  })

  if (normalizedRouteSegments.length === 0) {
    return null
  }

  const routeCoordinates = flattenRouteSegments(normalizedRouteSegments)
  if (routeCoordinates.length < 2) {
    return null
  }

  const bounds = calculateBounds(routeCoordinates)

  if (
    !Number.isFinite(bounds.minLat) ||
    !Number.isFinite(bounds.maxLat) ||
    !Number.isFinite(bounds.minLng) ||
    !Number.isFinite(bounds.maxLng)
  ) {
    return null
  }

  // Every hosted provider is best-effort: a failure (or missing geometry) falls
  // back to the self-rendered OSM tiles below. OSM tile errors keep propagating
  // to the caller.
  const mapProvider = getMapProviderConfig()
  switch (mapProvider.type) {
    case 'apple': {
      try {
        // The signed snapshot URL carries the developer credentials, so it is
        // fetched server-side inside fetchAppleSnapshot and never exposed.
        const snapshot = await fetchAppleSnapshot(
          {
            segments: normalizedRouteSegments.map((points) => ({ points })),
            width: APPLE_SNAPSHOT_WIDTH,
            height: APPLE_SNAPSHOT_HEIGHT,
            scale: APPLE_SNAPSHOT_SCALE
          },
          mapProvider
        )
        if (snapshot) return snapshot
        throw new Error('Apple Maps snapshot returned no image')
      } catch (error) {
        logger.warn({
          message: 'Apple Maps snapshot rendering failed; using OSM fallback',
          error: (error as Error).message
        })
      }
      break
    }
    case 'mapbox': {
      try {
        const response = await fetch(
          buildMapboxUrl({
            routeSegments: normalizedRouteSegments,
            width,
            height,
            accessToken: mapProvider.accessToken
          })
        )

        if (!response.ok) {
          throw new Error(
            `Mapbox request failed with status ${response.status}`
          )
        }

        return Buffer.from(await response.arrayBuffer())
      } catch (error) {
        logger.warn({
          message: 'Mapbox map rendering failed; using OSM fallback',
          error: (error as Error).message
        })
      }
      break
    }
    default:
      break
  }

  return renderOsmMap({
    routeSegments: normalizedRouteSegments,
    width,
    height
  })
}
